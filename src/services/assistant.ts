import { LlmEngine, LlmResponse, LlmChunk, LlmChunkContent } from 'multi-llm-ts'
import { removeMarkdown } from '@excalidraw/markdown-to-text'
import { Configuration } from 'types/config'
import Chat from '../models/chat'
import Attachment from '../models/attachment'
import Message from '../models/message'
import LlmFactory from '../llms/llm'
import { availablePlugins } from '../plugins/plugins'
import Generator, { GenerationResult, GenerationOpts } from './generator'
import { Expert } from 'types'

export interface AssistantCompletionOpts extends GenerationOpts {
  engine?: string
  titling?: boolean
  attachment?: Attachment
  expert?: Expert
  systemInstructions?: string
  searchQuery?: string
  searchResults?: Array<{
    title: string;
    content: string;
    url: string;
  }>;
}

export default class extends Generator {

  llmFactory: LlmFactory
  chat: Chat

  constructor(config: Configuration) {
    super(config)
    this.llm = null
    this.stream = null
    this.llmFactory = new LlmFactory(config)
    this.chat = new Chat()
  }

  setChat(chat: Chat) {
    this.chat = chat
  }

  initChat(): Chat {
    this.chat = new Chat()
    return this.chat
  }

  resetLlm() {
    this.llm = null
  }

  initLlm(engine: string): void {

    // same?
    if (this.llm !== null && this.llm.getName() === engine) {
      return
    }

    // switch
    const llm = this.llmFactory.igniteEngine(engine)
    this.setLlm(llm)
  }

  setLlm(llm: LlmEngine) {
    this.llm = llm
  }

  hasLlm() {
    return this.llm !== null
  }

  async prompt(prompt: string, opts: AssistantCompletionOpts, callback: (chunk: LlmChunk) => void, beforeTitleCallback?: () => void): Promise<void> {
    // check
    prompt = prompt.trim()
    if (prompt === '') {
      return null
    }

    // merge with defaults
    const defaults: AssistantCompletionOpts = {
      titling: true,
      ... this.llmFactory.getChatEngineModel(),
      attachment: null,
      docrepo: null,
      expert: null,
      sources: true,
      systemInstructions: this.config.instructions.default,
      citations: true,
      searchQuery: prompt// 确保搜索查询从一开始就被设置
    }
    opts = { ...defaults, ...opts }

    // console.log('详细的opts对象:', opts)

    // we need a chat
    if (this.chat === null) {
      this.initChat()
    }

    // we need messages
    if (this.chat.messages.length === 0) {
      this.chat.addMessage(new Message('system', this.getSystemInstructions(opts.systemInstructions)))
    }

    // make sure we have the right engine and model
    // special case: chat was started without an apiKey
    // so engine and model are null so we need to keep opts ones...
    opts.engine = this.chat.engine || opts.engine
    opts.model = this.chat.model || opts.model
    opts.docrepo = this.chat.docrepo || opts.docrepo

    // make sure chat options are set
    this.chat.setEngineModel(opts.engine, opts.model)
    this.chat.docrepo = opts.docrepo

    // we need an llm
    this.initLlm(opts.engine)
    if (this.llm === null) {
      return null
    }

    // make sure llm has latest tools
    this.llm.clearPlugins()
    if (!this.chat.disableTools) {
      for (const pluginName in availablePlugins) {
        const pluginClass = availablePlugins[pluginName]
        const instance = new pluginClass(this.config.plugins[pluginName])
        this.llm.addPlugin(instance)
      }
    }

    // add user message
    const userMessage = new Message('user', prompt)
    userMessage.engine = opts.engine
    userMessage.model = opts.model
    userMessage.expert = opts.expert
    userMessage.attach(opts.attachment)
    this.chat.addMessage(userMessage)

    // add assistant message
    const assistantMessage = new Message('assistant')
    assistantMessage.engine = opts.engine
    assistantMessage.model = opts.model
    this.chat.addMessage(assistantMessage)
    callback?.call(null, null)

    // generate text
    const hadPlugins = this.llm.plugins.length > 0
    let rc: GenerationResult = await this._prompt(opts, callback)

    console.log('[Ollama Debug] result text:', rc)

    // check if streaming is not supported
    if (rc === 'streaming_not_supported') {
      this.chat.disableStreaming = true
      rc = await this._prompt(opts, callback)
    }

    // titlingx
    if (rc !== 'success') {
      opts.titling = false
    }

    // check if generator disabled plugins
    if (hadPlugins && this.llm.plugins.length === 0) {
      this.chat.disableTools = true
    }

    // check if we need to update title
    if (opts.titling && !this.chat.hasTitle()) {
      beforeTitleCallback?.call(null)
      this.chat.title = await this.getTitle() || this.chat.title
    }

  }

  async _prompt(opts: AssistantCompletionOpts, callback: (chunk: LlmChunk) => void): Promise<GenerationResult> {
    // 插件执行前的检查
    if (this.llm.plugins.length > 0) {
      const lastUserMessage = this.chat.messages.findLast(m => m.role === 'user')

      // 确保有消息内容
      if (!lastUserMessage?.content?.trim()) {
        console.warn('[Assistant] Cannot execute plugins: No valid query content')
        return 'error'
      }

      // 确保搜索参数存在且有效
      if (!opts.searchQuery?.trim()) {
        opts.searchQuery = lastUserMessage.content.trim()
      }
    }

    // normal case: we stream
    if (!this.chat.disableStreaming) {
      try {
        return await this.generate(this.llm, this.chat.messages, {
          ...opts,
          ...this.chat.modelOpts,
        }, callback)
      } catch (error) {
        console.error('[Assistant] Error during generation:', error)
        return 'error'
      }
    }

    try {
      // normal completion
      const response: LlmResponse = await this.llm.complete(this.chat.model, this.chat.messages, {
        usage: true,
        ...opts,
        ...this.chat.modelOpts
      })

      // fake streaming
      const chunk: LlmChunk = {
        type: 'content',
        text: response.content,
        done: true
      }

      // add content
      this.chat.lastMessage().appendText(chunk)
      this.chat.lastMessage().usage = response.usage
      callback.call(null, chunk)

      // 非流式模式下，也使用 generate 方法来处理搜索结果
      if (opts.searchResults?.length > 0) {
        const referencesText = '\n\n相关引用：\n' + 
          opts.searchResults.map((result, index) => 
            `${index + 1}. [${result.title}](${result.url})`
          ).join('\n')
        
        const referencesChunk: LlmChunk = {
          type: 'content',
          text: referencesText,
          done: true
        }
        
        // this.chat.lastMessage().appendText(referencesChunk)
        callback.call(null, referencesChunk)
      }

      return 'success'
    } catch (error) {
      console.error('Error while trying to complete', error)
      return 'error'
    }
  }

  async attach(file: Attachment) {
    // 确保文件存在
    if (!file) {
      console.warn('[Assistant] No file to attach')
      return
    }

    // 如果最后一条消息不是用户消息，创建新的用户消息
    if (this.chat.lastMessage()?.role !== 'user') {
      this.chat.addMessage(new Message('user', 'Attached file for analysis'))
    }

    // 附加文件
    this.chat.lastMessage().attach(file)
  }

  async getTitle() {

    try {

      // build messages
      const messages = [
        new Message('system', this.getSystemInstructions(this.config.instructions.titling)),
        this.chat.messages[1],
        this.chat.messages[2],
        new Message('user', this.config.instructions.titling_user)
      ]

      // now get it
      this.initLlm(this.chat.engine)
      const response = await this.llm.complete(this.chat.model, messages)
      let title = response.content.trim()
      if (title === '') {
        return this.chat.messages[1].content
      }

      // ollama reasoning removal: everything between <think> and </think>
      title = title.replace(/<think>[\s\S]*?<\/think>/g, '')

      // remove html tags
      title = title.replace(/<[^>]*>/g, '')

      // and markdown
      title = removeMarkdown(title)

      // remove prefixes
      if (title.startsWith('Title:')) {
        title = title.substring(6)
      }

      // remove quotes
      title = title.trim().replace(/^"|"$/g, '').trim()

      // done
      return title

    } catch (error) {
      console.error('Error while trying to get title', error)
      return null
    }

  }

}
