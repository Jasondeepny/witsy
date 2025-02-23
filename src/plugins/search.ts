import { anyDict } from 'types/index'
import { PluginParameter } from 'multi-llm-ts'
import Plugin, { PluginConfig } from './plugin'
import Tavily from '../vendor/tavily'
import BraveSearch from '../vendor/brave/brave'
import { convert } from 'html-to-text'

export default class extends Plugin {

  constructor(config: PluginConfig) {
    super(config)
  }

  isEnabled(): boolean {
    return this.config?.enabled && (
      (this.config.engine === 'local') ||
      (this.config.engine === 'tavily' && this.config.tavilyApiKey?.trim().length > 0) ||
      (this.config.engine === 'brave' && this.config.braveApiKey?.trim().length > 0)
    )
  }

  getName(): string {
    return 'search_internet'
  }

  getDescription(): string {
    return 'This tool allows you to search the web for information on a given topic. Try to include links to the sources you use in your response.'
  }

  getPreparationDescription(): string {
    return this.getRunningDescription()
  }

  getRunningDescription(): string {
    return 'Searching the internet…'
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'query',
        type: 'string',
        description: 'The query to search for',
        required: true
      }
    ]
  }

  async execute(parameters: anyDict): Promise<anyDict> {
    console.log('[Search Plugin] execute:', {
      engine: this.config.engine,
      parameters,
      config: this.config
    })

    if (!parameters || !parameters.query) {
      console.error('[Search Plugin] No query provided')
      return {
        error: 'No search query provided. Please provide a valid search query.'
      }
    }

    try {
      let result
      if (this.config.engine === 'local') {
        result = await this.local(parameters)
      } else if (this.config.engine === 'tavily') {
        result = await this.tavily(parameters)
      } else if (this.config.engine === 'brave') {
        result = await this.brave(parameters)
      } else {
        result = { error: 'Invalid engine' }
      }
      console.log('[Search Plugin] Result:', result)
      return result
    } catch (error) {
      console.error('[Search Plugin] Execution error:', error)
      return { error: error.message }
    }
  }

  async brave(parameters: anyDict): Promise<anyDict> {
    if (!parameters.query) {
      console.error('[Brave Search] No query provided')
      return { error: 'No search query provided' }
    }

    try {
      if (!this.config.braveApiKey) {
        console.error('[Brave Search] No API Key configured')
        return {
          error: 'Brave API Key is not configured. Please set it in the settings.'
        }
      }

      const brave = new BraveSearch(this.config.braveApiKey)
      const results = await brave.search(parameters.query, {
        max_results: 5
      })

      return {
        query: parameters.query,
        results: results.results
      }
    } catch (error) {
      console.error('[Brave Search] Error:', error)
      return {
        error: `Brave search failed: ${error.message}`
      }
    }
  }

  async local(parameters: anyDict): Promise<anyDict> {
    try {
      const results = await window.api.search.query(parameters.query, 5)
      const response = {
        query: parameters.query,
        results: results.map(result => ({
          title: result.title,
          url: result.url,
          content: this.truncateContent(this.htmlToText(result.content))
        }))
      }
      //console.log('Local search response:', response)
      return response
    } catch (error) {
      return { error: error.message }
    }
  }

  async tavily(parameters: anyDict): Promise<anyDict> {
    // 再次验证参数
    if (!parameters.query) {
      console.error('[Tavily Search] No query provided')
      return { error: 'No search query provided' }
    }

    try {
      // 检查 API Key
      if (!this.config.tavilyApiKey) {
        console.error('[Tavily Search] No API Key configured')
        return {
          error: 'Tavily API Key is not configured. Please set it in the settings.'
        }
      }

      // 使用 Tavily 搜索
      const tavily = new Tavily(this.config.tavilyApiKey)
      const results = await tavily.search(parameters.query, {
        max_results: 5,
        include_answer: true,
        include_raw_content: true,
      })

      console.log('[Tavily Search] Raw results:', results)

      // 处理搜索结果
      const processedResults = results.results.map(result => ({
        title: result.title,
        url: result.url,
        content: this.truncateContent(result.content || result.raw_content || '')
      }))

      return {
        query: parameters.query,
        results: processedResults,
        answer: results.answer || ''
      }
    } catch (error) {
      console.error('[Tavily Search] Error:', error)
      return {
        error: `Tavily search failed: ${error.message}`
      }
    }
  }

  htmlToText(html: string): string {

    // if we find a main section then let's convert that only
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    if (main) {
      html = main[0]
    }

    return convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'nav', format: 'skip' },
        { selector: 'img', format: 'skip' },
        { selector: 'form', format: 'skip' },
        { selector: 'button', format: 'skip' },
        { selector: 'input', format: 'skip' },
        { selector: 'select', format: 'skip' },
        { selector: 'a', format: 'skip' },
      ]
    })
  }

  truncateContent(content: string): string {
    if (!this.config.contentLength) {
      return content
    } else {
      return content.slice(0, this.config.contentLength)
    }
  }

}
