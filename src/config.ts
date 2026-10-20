import path from 'node:path'
import type { Effort } from './types'

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

function intFrom(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : fallback
}

function floatFrom(value: string | undefined, fallback: number): number {
  const n = Number.parseFloat(value ?? '')
  return Number.isFinite(n) ? n : fallback
}

function effortFrom(value: string | undefined, fallback: Effort): Effort {
  return EFFORTS.find((e) => e === value) ?? fallback
}

export interface VoyageConfig {
  apiKey: string
  model: string
  dimension: number
}

export interface VapiConfig {
  publicKey: string
  assistantId: string
  customLlmSecret: string
  publicBaseUrl: string
}

export interface AppConfig {
  port: number
  dataDir: string
  voyage: VoyageConfig
  claude: {
    model: string
    maxTokens: number
    effort: { text: Effort, voice: Effort }
  }
  rag: { topK: number, minSimilarity: number }
  vapi: VapiConfig
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: intFrom(env.PORT, 3000),
    dataDir: path.resolve(env.LMSYS_DATA_DIR || 'data'),
    voyage: {
      apiKey: env.VOYAGE_API_KEY || '',
      model: env.VOYAGE_MODEL || 'voyage-3.5',
      dimension: intFrom(env.VOYAGE_DIM, 1024)
    },
    claude: {
      model: env.CLAUDE_MODEL || 'claude-opus-5-5',
      maxTokens: intFrom(env.CLAUDE_MAX_TOKENS, 64000),
      effort: {
        text: effortFrom(env.CLAUDE_EFFORT_TEXT, 'low'),
        voice: effortFrom(env.CLAUDE_EFFORT_VOICE, 'low')
      }
    },
    rag: {
      topK: intFrom(env.RAG_TOP_K, 4),
      minSimilarity: floatFrom(env.MIN_SIMILARITY, 0.5)
    },
    vapi: {
      publicKey: env.VAPI_PUBLIC_KEY || '',
      assistantId: env.VAPI_ASSISTANT_ID || '',
      customLlmSecret: env.VAPI_CUSTOM_LLM_SECRET || '',
      publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    }
  }
}
