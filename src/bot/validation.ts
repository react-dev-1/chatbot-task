import type { ChatTurn } from '../types'

export const MAX_MESSAGE_CHARS = 1000
// Counted after merging, so speech split into fragments doesn't shrink the window.
export const MAX_HISTORY_TURNS = 40
const MAX_HISTORY_TOTAL_CHARS = 40_000
const MAX_HISTORY_CONTENT_CHARS = 8000

export type ValidationResult =
  | { value: { message: string, history: ChatTurn[] }, error?: undefined }
  | { error: string, value?: undefined }

function isChatTurn(turn: unknown): turn is ChatTurn {
  if (!turn || typeof turn !== 'object') return false
  const { role, content } = turn as Record<string, unknown>
  return (role === 'user' || role === 'assistant') &&
    typeof content === 'string' &&
    content.length <= MAX_HISTORY_CONTENT_CHARS
}

export function validateChatRequest(body: unknown): ValidationResult {
  const { message: rawMessage, history: rawHistory = [] } = (body ?? {}) as Record<string, unknown>
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    return { error: 'message is required' }
  }
  const message = rawMessage.trim()
  if (message.length > MAX_MESSAGE_CHARS) {
    return { error: `message must be at most ${MAX_MESSAGE_CHARS} characters` }
  }

  if (!Array.isArray(rawHistory)) return { error: 'history must be an array' }
  if (!rawHistory.every(isChatTurn)) {
    return { error: 'history entries must be { role: "user" | "assistant", content: string }' }
  }

  return { value: { message, history: normalizeHistory(rawHistory) } }
}

// Drops empty turns, merges same-role neighbours (voice transcripts arrive as
// fragments), keeps the most recent turns within the turn and size limits, and
// makes sure the history starts with a user turn and ends with an assistant
// turn, so appending the new user message yields a valid Messages API conversation.
export function normalizeHistory(history: ChatTurn[]): ChatTurn[] {
  const merged: ChatTurn[] = []
  for (const { role, content } of history) {
    if (!content.trim()) continue
    const last = merged[merged.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else merged.push({ role, content })
  }

  const kept = merged.slice(-MAX_HISTORY_TURNS)
  let total = kept.reduce((sum, t) => sum + t.content.length, 0)
  while (kept.length && total > MAX_HISTORY_TOTAL_CHARS) total -= kept.shift()!.content.length

  while (kept.length && kept[0].role !== 'user') kept.shift()
  while (kept.length && kept[kept.length - 1].role !== 'assistant') kept.pop()
  return kept
}
