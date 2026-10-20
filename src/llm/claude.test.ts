import { Anthropic } from '@anthropic-ai/sdk'
import { createClaudeClient, LlmError } from './claude'
import type { StreamingClient } from './claude'
import type { StreamResult } from '../types'

type StreamCall = { params: unknown, options?: { signal?: AbortSignal } }

// Stands in for client.beta.messages.stream(): an async iterable of stream events
// plus finalMessage(), the two parts of MessageStream the wrapper uses.
function fakeAnthropic({ texts = [], stopReason = 'end_turn', error }: {
  texts?: string[]
  stopReason?: string
  error?: Error
}): StreamingClient & { calls: StreamCall[] } {
  const calls: StreamCall[] = []
  const client = {
    calls,
    beta: {
      messages: {
        stream(params: unknown, options?: { signal?: AbortSignal }) {
          calls.push({ params, options })
          return {
            async* [Symbol.asyncIterator]() {
              if (error) throw error
              yield { type: 'message_start' }
              for (const text of texts) {
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
              }
            },
            finalMessage: async () => ({
              model: 'claude-opus-5-5',
              stop_reason: stopReason,
              usage: { input_tokens: 10, output_tokens: 5 }
            })
          }
        }
      }
    }
  }
  return client as unknown as StreamingClient & { calls: StreamCall[] }
}

const silentLogger = { info: () => {} }

async function collect(generator: AsyncGenerator<string, StreamResult, void>) {
  const texts: string[] = []
  for (;;) {
    const step = await generator.next()
    if (step.done) return { texts, result: step.value }
    texts.push(step.value)
  }
}

describe('createClaudeClient', () => {
  test('streams text deltas and builds the request', async () => {
    const client = fakeAnthropic({ texts: ['Hi', ' there'] })
    const claude = createClaudeClient({ model: 'claude-opus-5-5', maxTokens: 64000, client, logger: silentLogger })
    const signal = new AbortController().signal

    const { texts, result } = await collect(claude.streamReply({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      effort: 'low',
      signal
    }))

    expect(texts).toEqual(['Hi', ' there'])
    expect(result.stopReason).toBe('end_turn')
    const { params, options } = client.calls[0]
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      cache_control: { type: 'ephemeral' },
      system: 'sys'
    })
    expect(params).not.toHaveProperty('thinking')
    expect(options?.signal).toBe(signal)
  })

  test('reports a refusal stop reason', async () => {
    const claude = createClaudeClient({ model: 'm', maxTokens: 1, client: fakeAnthropic({ stopReason: 'refusal' }), logger: silentLogger })

    const { result } = await collect(claude.streamReply({ system: 's', messages: [], effort: 'low' }))

    expect(result.stopReason).toBe('refusal')
  })

  test('maps SDK errors to user-safe LlmErrors', async () => {
    const error = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers())
    const claude = createClaudeClient({ model: 'm', maxTokens: 1, client: fakeAnthropic({ error }), logger: silentLogger })

    const promise = collect(claude.streamReply({ system: 's', messages: [], effort: 'low' }))

    await expect(promise).rejects.toBeInstanceOf(LlmError)
    await expect(promise).rejects.toMatchObject({ kind: 'rate_limited' })
  })
})
