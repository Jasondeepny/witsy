import axios from 'axios'

interface BraveSearchResult {
    title: string
    url: string
    description: string
}

interface BraveSearchResponse {
    web: {
        results: BraveSearchResult[]
    }
}

export default class BraveSearch {
    private apiKey: string
    private baseUrl = 'https://api.search.brave.com/res/v1/web/search'

    constructor(apiKey: string) {
        this.apiKey = apiKey
    }

    async search(query: string, options: { max_results?: number } = {}) {
        try {
            const response = await axios.get<BraveSearchResponse>(this.baseUrl, {
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': this.apiKey
                },
                params: {
                    q: query,
                    count: options.max_results || 5
                }
            })

            return {
                results: response.data.web.results.map(result => ({
                    title: result.title,
                    url: result.url,
                    content: result.description
                }))
            }
        } catch (error) {
            console.error('[Brave Search] Error:', error)
            throw new Error(`Brave search failed: ${error.message}`)
        }
    }
} 