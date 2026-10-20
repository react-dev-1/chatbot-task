import { LlmError } from '../llm/claude'
import { VoyageError } from '../embeddings/voyage'

const GENERIC = 'Sorry, something went wrong. Please try again.'

// Maps internal errors to a message that is safe to show users, and logs the rest.
export function publicErrorMessage(err: unknown, logger: Pick<Console, 'error'> = console): string {
  if (err instanceof LlmError) return err.message
  if (err instanceof VoyageError) {
    logger.error(err.message)
    return 'Search is temporarily unavailable. Please try again.'
  }
  logger.error(err)
  return GENERIC
}
