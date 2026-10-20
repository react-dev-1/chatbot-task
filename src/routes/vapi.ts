import crypto from 'node:crypto'
import express from 'express'
import { normalizeHistory, MAX_MESSAGE_CHARS } from '../bot/validation'
import { createSpeechFilter } from '../bot/speech'
import { startSse, sendData, endSse, clientAbortSignal } from '../http/sse'
import { publicErrorMessage } from '../http/errors'
import type { ChatTurn, Responder } from '../types'

interface OpenAiMessage {
  role?: unknown
  content?: unknown
}

// Vapi sends the Custom LLM API key in the Authorization header; accept it with
// or without a "Bearer " prefix.
function secretMatches(header: string | undefined, secret: string): boolean {
  if (!secret || typeof header !== 'string') return false
  const given = Buffer.from(header.replace(/^Bearer\s+/i, '').trim())
  const expected = Buffer.from(secret)
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: 'text', text: string } => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

// Splits an OpenAI-style messages array into { message, history }. Vapi's own
// system prompt is ignored: the server owns the prompt.
export function fromOpenAiMessages(messages: unknown): { message: string, history: ChatTurn[] } | null {
  const turns: ChatTurn[] = (Array.isArray(messages) ? messages as OpenAiMessage[] : [])
    .filter((m): m is OpenAiMessage & { role: ChatTurn['role'] } => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({ role: m.role, content: textOf(m.content) }))

  const lastUser = turns.map((t) => t.role).lastIndexOf('user')
  if (lastUser === -1 || !turns[lastUser].content.trim()) return null
  return {
    message: turns[lastUser].content.trim().slice(0, MAX_MESSAGE_CHARS),
    history: normalizeHistory(turns.slice(0, lastUser))
  }
}

function chunk(id: string, model: string, delta: { role?: 'assistant', content?: string }, finishReason: 'stop' | null = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  }
}

export function createVapiRouter({ responder, secret }: { responder: Responder, secret: string }): express.Router {
  const router = express.Router()

  router.post('/vapi/chat/completions', async (req, res) => {
    if (!secretMatches(req.get('authorization'), secret)) {
      console.warn(`Rejected /vapi call: ${req.get('authorization') ? 'wrong' : 'missing'} Authorization header`)
      res.status(401).json({ error: { message: 'Unauthorized' } })
      return
    }
    const parsed = fromOpenAiMessages(req.body?.messages)
    if (!parsed) {
      res.status(400).json({ error: { message: 'messages must include a user message' } })
      return
    }
    console.log(JSON.stringify({
      event: 'vapi_turn',
      received_messages: Array.isArray(req.body?.messages) ? req.body.messages.length : 0,
      history_turns: parsed.history.length
    }))

    const id = `chatcmpl-${crypto.randomUUID()}`
    const model = typeof req.body?.model === 'string' ? req.body.model : 'lmsys-rag'
    const speech = createSpeechFilter()
    const signal = clientAbortSignal(res)
    const send = (text: string) => { if (text) sendData(res, chunk(id, model, { content: text })) }

    startSse(res)
    sendData(res, chunk(id, model, { role: 'assistant' }))
    try {
      for await (const event of responder.respond({ ...parsed, channel: 'voice', signal })) {
        if (event.type === 'delta') send(speech.push(event.text))
      }
      send(speech.flush())
    } catch (err) {
      if (signal.aborted) {
        res.end()
        return
      }
      send(publicErrorMessage(err))
    }
    sendData(res, chunk(id, model, {}, 'stop'))
    endSse(res)
  })

  return router
}
