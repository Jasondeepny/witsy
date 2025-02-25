import { LlmEngine, LlmCompletionOpts, LlmChunk } from 'multi-llm-ts'
import { Configuration } from '../types/config'
import { DocRepoQueryResponseItem } from '../types/rag'
import { countryCodeToName } from './i18n'
import Message from '../models/message'
import { REFERENCE_PROMPT } from './prompt'

export interface GenerationOpts extends LlmCompletionOpts {
  model: string
  docrepo?: string
  sources?: boolean
  searchResults?: SearchResult[]
}

export type GenerationResult =
  'success' |
  'missing_api_key' |
  'out_of_credits' |
  'quota_exceeded' |
  'context_too_long' |
  'invalid_model' |
  'function_description_too_long' |
  'function_call_not_supported' |
  'streaming_not_supported' |
  'error'

interface SearchResult {
  title: string
  url: string
  content: string
}

interface SearchResponse {
  query?: string
  results?: SearchResult[]
  answer?: string
  error?: string
}

export default class Generator {

  config: Configuration
  stopGeneration: boolean
  stream: AsyncIterable<LlmChunk> | null = null
  llm: LlmEngine | null = null

  static addDateAndTimeToSystemInstr = true

  constructor(config: Configuration) {
    this.config = config
    this.stopGeneration = false
  }

  async generate(llm: LlmEngine, messages: Message[], opts: GenerationOpts, callback?: (chunk: LlmChunk) => void): Promise<GenerationResult> {
    console.log('[Generator] Starting generation:', {
      engine: llm.getName(),
      message: messages,
      pluginsEnabled: llm.plugins.length > 0,
      plugins: llm.plugins.map(p => p.getName())
    })

    // 插件结果可能会在这里被使用
    const conversation = this.getConversation(messages)


    // 检查插件是否被调用
    for (const plugin of llm.plugins) {
      console.log(`[Generator] Checking plugin: ${plugin.getName()}`)
      if (plugin.getName() === 'search_internet') {
        console.log('[Generator] Search plugin is available and will be used')
      }
    }

    // 在生成器中，检查插件结果是否被使用
    const pluginResults = await this.runPlugins(llm, messages, opts)
    console.log('[Generator] Plugin results:', pluginResults)

    // 添加插件消息到对话中,并将搜索结果存储在一个临时变量中供后续使用
    if (pluginResults.pluginMessages && pluginResults.pluginMessages.length > 0) {
      conversation.push(...pluginResults.pluginMessages)
      //存储在opts 中 在 assistant.ts 中使用
      opts.searchResults = pluginResults.references
    }

    // return code
    let rc: GenerationResult = 'success'

    // get messages
    const response = messages[messages.length - 1]

    try {
      // rag?
      let sources: DocRepoQueryResponseItem[] = [];
      if (opts.docrepo) {
        const userMessage = conversation[conversation.length - 1];
        console.log('[Ollama Debug] message', userMessage.content)
        sources = await window.api.docrepo.query(opts.docrepo, userMessage.content);
        console.log('[Ollama Debug] Sources', JSON.stringify(sources, null, 2));
        if (sources.length > 0) {
          const context = sources.map((source) => source.content).join('\n\n');
          const prompt = this.config.instructions.docquery.replace('{context}', context).replace('{query}', userMessage.content);
          conversation[conversation.length - 1] = new Message('user', prompt);
        }
      }

      // debug
      console.log(`[Ollama Debug] Generation with ${llm.plugins.length} plugins and opts ${JSON.stringify(opts)}`)

      // now stream
      this.stopGeneration = false
      llm.clearPlugins() // 临时清除插件(禁用Function Calling)
      this.stream = await llm.generate(opts.model, conversation, {
        models: this.config.engines[llm.getName()]?.models?.chat,
        autoSwitchVision: this.config.llm.autoVisionSwitch,
        usage: true,
        ...opts
      })
      console.log('[Generator] Generation started successfully')
      for await (const msg of this.stream) {
        if (this.stopGeneration) {
          response.appendText({ type: 'content', text: '', done: true })
          break
        }
        if (msg.type === 'usage') {
          response.usage = msg.usage
        } else if (msg.type === 'tool') {
          response.setToolCall(msg)
        } else if (msg.type === 'content') {
          if (msg && sources && sources.length > 0) {
            msg.done = false
          }
          response.appendText(msg)
          callback?.call(null, msg)
        } else if (msg.type === 'reasoning') {
          response.appendText(msg)
          callback?.call(null, msg)
        }
      }

      // append sources
      if (opts.sources && sources && sources.length > 0) {

        // reduce to unique sources based on metadata.id
        const uniqueSourcesMap = new Map();
        sources.forEach(source => {
          uniqueSourcesMap.set(source.metadata.uuid, source);
        })
        sources = Array.from(uniqueSourcesMap.values());

        // now add them
        let sourcesText = '\n\nSources:\n\n'
        sourcesText += sources.map((source) => `- [${source.metadata.title}](${source.metadata.url})`).join('\n')
        response.appendText({ type: 'content', text: sourcesText, done: true })
        callback?.call(null, { type: 'content', text: sourcesText, done: true })
      }

    } catch (error) {
      console.error('[Generator] Generation error:', error)
      if (error.name !== 'AbortError') {
        const message = error.message.toLowerCase()

        // missing api key
        if ([401, 403].includes(error.status) || message.includes('401') || message.includes('apikey')) {
          response.setText('You need to enter your API key in the Models tab of <a href="#settings_models">Settings</a> in order to chat.')
          rc = 'missing_api_key'
        }

        // out of credits
        else if ([400, 402].includes(error.status) && (message.includes('credit') || message.includes('balance'))) {
          response.setText('Sorry, it seems you have run out of credits. Check the balance of your LLM provider account.')
          rc = 'out_of_credits'

          // quota exceeded
        } else if ([429].includes(error.status) && (message.includes('resource') || message.includes('quota') || message.includes('too many'))) {
          response.setText('Sorry, it seems you have reached the rate limit of your LLM provider account. Try again later.')
          rc = 'quota_exceeded'

          // context length or function description too long
        } else if ([400].includes(error.status) && (message.includes('context length') || message.includes('too long'))) {
          if (message.includes('function.description')) {
            response.setText('Sorry, it seems that one of the plugins description is too long. If you tweaked them in Settings | Advanced, please try again.')
            rc = 'function_description_too_long'
          } else {
            response.setText('Sorry, it seems this message exceeds this model context length. Try to shorten your prompt or try another model.')
            rc = 'context_too_long'
          }

          // function call not supported
        } else if ([400, 404].includes(error.status) && llm.plugins.length > 0 && (message.includes('function call') || message.includes('tools') || message.includes('tool use') || message.includes('tool choice'))) {
          console.log('Model does not support function calling: removing tool and retrying')
          llm.clearPlugins()
          return this.generate(llm, messages, opts, callback)

          // streaming not supported
        } else if ([400].includes(error.status) && message.includes('\'stream\' does not support true')) {
          rc = 'streaming_not_supported'

          // invalid model
        } else if ([404].includes(error.status) && message.includes('model')) {
          response.setText('Sorry, it seems this model is not available.')
          rc = 'invalid_model'

          // final error: depends if we already have some content and if plugins are enabled
        } else {
          if (response.content === '') {
            if (opts.contextWindowSize || opts.maxTokens || opts.temperature || opts.top_k || opts.top_p) {
              response.setText('Sorry, I could not generate text for that prompt. Do you want to <a href="#retry_without_params">try again without model parameters</a>?')
            } else if (llm.plugins.length > 0) {
              response.setText('Sorry, I could not generate text for that prompt. Do you want to <a href="#retry_without_plugins">try again without plugins</a>?')
            } else {
              response.setText('Sorry, I could not generate text for that prompt.')
            }
          } else {
            response.appendText({ type: 'content', text: '\n\nSorry, I am not able to continue here.', done: true })
          }
          rc = 'error'
        }
      } else {
        callback?.call(null, { type: 'content', text: null, done: true })
      }
    }

    // cleanup
    this.stream = null
    //callback?.call(null, null)

    // done
    return rc
  }

  async stop() {
    if (this.stream) {
      this.stopGeneration = true
      try {
        await this.llm?.stop(this.stream)
      } catch { /* empty */ }
    }
  }

  getConversation(messages: Message[]): Message[] {
    const conversationLength = this.config.llm.conversationLength
    const chatMessages = messages.filter((msg) => msg.role !== 'system')
    const conversation = [
      new Message('system', this.patchSystemInstructions(messages[0].content)),
      ...chatMessages.slice(-conversationLength * 2, -1)
    ]
    for (const message of conversation) {
      if (message.attachment && !message.attachment.content) {
        message.attachment.loadContents()
      }
    }
    return conversation
  }

  getSystemInstructions(instructions?: string) {

    // default
    let instr = instructions || this.config.instructions.default

    // language. asking the LLM to talk in the user language confuses them more than often!
    if (this.config.general.language) instr += ' Always answer in ' + countryCodeToName(this.config.general.language) + '.'
    //else instr += ' Always reply in the user language unless expicitely asked to do otherwise.'

    // add date and time
    if (Generator.addDateAndTimeToSystemInstr) {
      instr += ' Current date and time is ' + new Date().toLocaleString() + '.'
    }

    // done
    return instr
  }

  patchSystemInstructions(instructions: string) {
    return instructions.replace(/Current date and time is [^.]+/, 'Current date and time is ' + new Date().toLocaleString())
  }

  // 优化延迟重试的实现
  private delay(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  // 修改 runPlugins 方法返回类型
  async runPlugins(llm: LlmEngine, messages: Message[], opts: GenerationOpts): Promise<{
    pluginMessages: Message[],
    references: SearchResult[]
  }> {
    const pluginMessages: Message[] = []
    let searchResults: SearchResult[] = []

    // 查找最后一条用户消息
    const userMessage = messages.findLast(msg => msg.role === 'user')
    if (!userMessage || !userMessage.content?.trim()) {
      console.warn('[Generator] No valid user message found for plugins')
      return {
        pluginMessages: [],
        references: []
      }
    }

    for (const plugin of llm.plugins) {
      if (plugin.getName() === 'search_internet') {
        try {
          console.log('[Generator] Executing search with query:', userMessage.content)

          // 添加重试逻辑
          let retryCount = 0;
          let result: SearchResponse;

          while (retryCount < 3) {
            try {
              result = await plugin.execute({
                query: userMessage.content.trim(),
                ...opts
              }) as SearchResponse

              if (result && !result.error) {
                break; // 成功获取结果，跳出重试循环
              }

              retryCount++;
              if (retryCount < 3) {
                await this.delay(1000 * retryCount); // 使用优化后的延迟函数
              }
            } catch (err) {
              console.error(`[Generator] Search attempt ${retryCount + 1} failed:`, err);
              retryCount++;
              if (retryCount < 3) {
                await this.delay(1000 * retryCount);
              }
            }
          }

          if (!result || result.error) {
            console.warn('[Generator] Search failed after retries:', result?.error || 'No result');
            // 添加一个系统消息说明搜索失败
            //pluginResults.push(new Message('system', 'Search operation failed. Proceeding with conversation without search results.'));
            continue;
          }

          console.log('[Generator] Raw search result:', result)

          let resultContent = ''

          // 处理搜索结果
          if (result.results && result.results.length > 0) {
            // resultContent = result.results.map(item =>
            //   `[${item.title}](${item.url})\n${item.content}`
            // ).join('\n\n')
            searchResults = result.results
            const referenceContent = `\`\`\`json\n${JSON.stringify(result.results, null, 2)}\n\`\`\``
            resultContent = REFERENCE_PROMPT.replace('{question}', userMessage.content).replace('{references}', referenceContent)
          }

          if (resultContent) {
            const pluginResult = new Message('system', resultContent)
            console.log('[Generator] Processed plugin result:', resultContent)
            pluginMessages.push(pluginResult) // 修复变量名,使用正确的 pluginMessages 数组
          }
        } catch (error) {
          console.error('[Generator] Fatal error in search execution:', error)
          pluginMessages.push(new Message('system', 'An error occurred while searching. Proceeding with conversation without search results.'))
        }
      }
    }
    return {
      pluginMessages,
      references: searchResults
    }
  }
}
