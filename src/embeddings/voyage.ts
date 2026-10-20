import type { Embedder } from '../types'

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings'
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

export class VoyageError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'VoyageError'
    this.status = status
  }
}

interface VoyageResponse {
  data: { index: number, embedding: number[] }[]
}

export interface VoyageClientOptions {
  apiKey: string
  model: string
  dimension: number
  fetchImpl?: typeof fetch
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function normalize(vector: ArrayLike<number>): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const norm = Math.sqrt(sum) || 1
  return Float32Array.from(vector, (v) => v / norm)
}

// embed() returns L2-normalised vectors in input order.
// Prompts and queries are embedded the same way (no input_type) because we match
// a question against other questions, which is a symmetric similarity task.
export function createVoyageClient({
  apiKey,
  model,
  dimension,
  fetchImpl = fetch,
  maxRetries = 4,
  baseDelayMs = 500,
  maxDelayMs = 60_000
}: VoyageClientOptions): Embedder {
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not set')

  // Exponential back-off, but never shorter than a Retry-After the server sends.
  function retryDelay(attempt: number, res?: Response): number {
    const retryAfter = Number(res?.headers?.get('retry-after'))
    const backoff = baseDelayMs * 2 ** attempt
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(backoff, retryAfter * 1000) : backoff
    return Math.min(delay, maxDelayMs)
  }

  async function embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const body = JSON.stringify({ input: texts, model, output_dimension: dimension })

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetchImpl(VOYAGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body
        })
      } catch (err) {
        if (attempt >= maxRetries) throw new VoyageError(`Voyage request failed: ${(err as Error).message}`)
        await sleep(retryDelay(attempt))
        continue
      }

      if (res.ok) {
        const json = await res.json() as VoyageResponse
        return json.data
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => normalize(d.embedding))
      }

      if (!RETRYABLE.has(res.status) || attempt >= maxRetries) {
        const detail = await res.text().catch(() => '')
        throw new VoyageError(`Voyage returned ${res.status}: ${detail.slice(0, 200)}`, res.status)
      }
      await sleep(retryDelay(attempt, res))
    }
  }

  return { embed }
}
