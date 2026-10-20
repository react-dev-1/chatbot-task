import type { Pair } from '../types'

// The subset of an LMSYS-Chat-1M row that ingest reads.
export interface LmsysRow {
  conversation_id: string
  model: string
  language: string
  redacted: boolean
  openai_moderation: { flagged: boolean }[] | null
  conversation: { role: string, content: string }[] | null
}

export const LIMITS = {
  promptMin: 3,
  promptMax: 500,
  replyMin: 20,
  replyMax: 4000
}

const REFUSAL_STUB = /^(i'?m sorry|sorry,|i apologi[sz]e|as an ai( language model)?|i cannot|i can'?t)\b/i
const REFUSAL_STUB_MAX_CHARS = 300

export function isFlagged(row: LmsysRow): boolean {
  return Array.isArray(row.openai_moderation) && row.openai_moderation.some((m) => m?.flagged)
}

function isUsableConversation(row: LmsysRow): boolean {
  return row.language === 'English' && row.redacted === false && !isFlagged(row) && Array.isArray(row.conversation)
}

export function isRefusalStub(reply: string): boolean {
  return reply.length <= REFUSAL_STUB_MAX_CHARS && REFUSAL_STUB.test(reply.trim())
}

export function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Turns one dataset row into zero or more prompt/reply pairs.
export function extractPairs(row: LmsysRow): Pair[] {
  if (!isUsableConversation(row) || !row.conversation) return []
  const pairs: Pair[] = []
  const turns = row.conversation
  for (let i = 0; i < turns.length - 1; i++) {
    const user = turns[i]
    const assistant = turns[i + 1]
    if (user?.role !== 'user' || assistant?.role !== 'assistant') continue
    const prompt = String(user.content ?? '').trim()
    const reply = String(assistant.content ?? '').trim()
    if (prompt.length < LIMITS.promptMin || prompt.length > LIMITS.promptMax) continue
    if (reply.length < LIMITS.replyMin || reply.length > LIMITS.replyMax) continue
    if (isRefusalStub(reply)) continue
    pairs.push({
      id: `${row.conversation_id}:${i}`,
      prompt,
      reply,
      model: row.model,
      conversationId: row.conversation_id
    })
  }
  return pairs
}
