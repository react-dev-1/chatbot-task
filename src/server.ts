import { loadConfig } from './config'
import { createApp } from './app'
import { createVoyageClient } from './embeddings/voyage'
import { loadIndex } from './retrieval/vectorIndex'
import { createClaudeClient } from './llm/claude'
import { createRagResponder } from './bot/ragResponder'

function main(): void {
  const config = loadConfig()

  const started = Date.now()
  const index = loadIndex(config.dataDir, config.voyage)
  console.log(`Loaded ${index.size} LMSYS pairs (${config.voyage.model}, ${index.dimension}d) in ${Date.now() - started} ms`)

  const responder = createRagResponder({
    embedder: createVoyageClient(config.voyage),
    index,
    llm: createClaudeClient(config.claude),
    topK: config.rag.topK,
    minSimilarity: config.rag.minSimilarity,
    effort: config.claude.effort
  })

  if (!config.vapi.customLlmSecret) {
    console.warn('VAPI_CUSTOM_LLM_SECRET is not set: voice calls will be rejected.')
  }

  createApp({ responder, config }).listen(config.port, () => {
    console.log(`Listening on http://localhost:${config.port}`)
  })
}

try {
  main()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
