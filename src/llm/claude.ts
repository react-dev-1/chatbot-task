import { Anthropic } from '@anthropic-ai/sdk'
import type { LlmClient, ReplyRequest, StreamResult } from '../types'

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0]
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent
type FinalMessage = Pick<Anthropic.Beta.Messages.BetaMessage, 'model' | 'stop_reason' | 'usage'>

// The slice of the SDK client this module uses; lets tests pass a small fake.
export interface StreamingClient {
  beta: {
    messages: {
      stream(params: StreamParams, options?: { signal?: AbortSignal }): AsyncIterable<StreamEvent> & {
        finalMessage(): Promise<FinalMessage>
      }
    }
  }
}

export type LlmErrorKind = 'rate_limited' | 'auth' | 'bad_request' | 'aborted' | 'unavailable'

export class LlmError extends Error {
  kind: LlmErrorKind

  constructor(message: string, kind: LlmErrorKind) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

export function toLlmError(err: unknown): unknown {
  if (err instanceof Anthropic.RateLimitError) return new LlmError('The assistant is busy, please try again in a moment.', 'rate_limited')
  if (err instanceof Anthropic.AuthenticationError) return new LlmError('The assistant is not configured correctly.', 'auth')
  if (err instanceof Anthropic.BadRequestError) return new LlmError('The request could not be processed.', 'bad_request')
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError('Request cancelled.', 'aborted')
  if (err instanceof Anthropic.APIError) return new LlmError('The assistant is temporarily unavailable.', 'unavailable')
  return err
}

export interface ClaudeClientOptions {
  model: string
  maxTokens: number
  client?: StreamingClient
  logger?: Pick<Console, 'info'>
}

export function createClaudeClient({
  model,
  maxTokens,
  client = new Anthropic(),
  logger = console
}: ClaudeClientOptions): LlmClient {
  async function* streamReply({ system, messages, effort, signal }: ReplyRequest): AsyncGenerator<string, StreamResult, void> {
    try {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort },
        cache_control: { type: 'ephemeral' },
        system,
        messages
      }, { signal })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        }
      }

      const final = await stream.finalMessage()
      const { usage } = final
      logger.info(JSON.stringify({
        event: 'claude_usage',
        model: final.model,
        stop_reason: final.stop_reason,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens
      }))
      return { stopReason: final.stop_reason }
    } catch (err) {
      throw toLlmError(err)
    }
  }

  return { streamReply }
}
