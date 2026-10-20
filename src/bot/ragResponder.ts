import { buildSystemPrompt, buildUserTurn } from './prompt'
import type { Effort, Embedder, LlmClient, Responder, ResponderEvent, RespondRequest, StreamResult, VectorIndex } from '../types'

export const REFUSAL_MESSAGE = "Sorry, I can't help with that one. Is there something else I can do for you?"

export interface RagResponderOptions {
  embedder: Embedder
  index: VectorIndex
  llm: LlmClient
  topK: number
  minSimilarity: number
  effort: { text: Effort, voice: Effort }
}

// respond() yields one 'meta' event, then 'delta' events, and throws on
// embedding or LLM failure (the route turns that into an error event).
export function createRagResponder({ embedder, index, llm, topK, minSimilarity, effort }: RagResponderOptions): Responder {
  async function* respond({ message, history = [], channel = 'text', signal }: RespondRequest): AsyncGenerator<ResponderEvent, void, void> {
    const [queryVector] = await embedder.embed([message])
    const matches = index.search(queryVector, topK).filter((m) => m.similarity >= minSimilarity)

    yield {
      type: 'meta',
      sources: matches.map((m) => ({ model: m.pair.model, similarity: Number(m.similarity.toFixed(3)) }))
    }

    const reply = llm.streamReply({
      system: buildSystemPrompt(channel),
      messages: [
        ...history.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: buildUserTurn(message, matches) }
      ],
      effort: effort[channel],
      signal
    })

    let sentText = false
    let result: StreamResult
    for (;;) {
      const step = await reply.next()
      if (step.done) {
        result = step.value
        break
      }
      sentText = true
      yield { type: 'delta', text: step.value }
    }

    if (result.stopReason === 'refusal') {
      yield { type: 'delta', text: sentText ? `\n\n${REFUSAL_MESSAGE}` : REFUSAL_MESSAGE }
    }
  }

  return { respond }
}
