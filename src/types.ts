export type Channel = 'text' | 'voice'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// One (user prompt -> assistant reply) pair from LMSYS-Chat-1M.
export interface Pair {
  id: string
  prompt: string
  reply: string
  model: string
  conversationId: string
}

export interface Match {
  pair: Pair
  similarity: number
}

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>
}

export interface VectorIndex {
  search(query: Float32Array, k: number): Match[]
  size: number
  dimension: number
}

export interface StreamResult {
  stopReason: string | null
}

export interface ReplyRequest {
  system: string
  messages: ChatTurn[]
  effort: Effort
  signal?: AbortSignal
}

export interface LlmClient {
  streamReply(request: ReplyRequest): AsyncGenerator<string, StreamResult, void>
}

export type ResponderEvent =
  | { type: 'meta', sources: { model: string, similarity: number }[] }
  | { type: 'delta', text: string }

export interface RespondRequest {
  message: string
  history?: ChatTurn[]
  channel?: Channel
  signal?: AbortSignal
}

export interface Responder {
  respond(request: RespondRequest): AsyncGenerator<ResponderEvent, void, void>
}
