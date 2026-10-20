// Test doubles built on the synthetic fixture. No network calls.
import fs from 'node:fs'
import path from 'node:path'
import { createVectorIndex } from '../retrieval/vectorIndex'
import { createRagResponder } from '../bot/ragResponder'
import { createApp } from '../app'
import type { AppConfig } from '../config'
import type { Embedder, LlmClient, Pair, ReplyRequest, StreamResult, VectorIndex } from '../types'

export const DIMENSION = 4

// Topic keyword -> one-hot vector. Pair i in the fixture is about topic i.
const TOPICS = ['python', 'france', 'cover letter', 'system prompt']

export function loadFixturePairs(): Pair[] {
  return fs.readFileSync(path.join(__dirname, 'pairs.sample.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Pair)
}

function oneHot(i: number): Float32Array {
  const v = new Float32Array(DIMENSION)
  v[i] = 1
  return v
}

export function fixtureIndex(): VectorIndex {
  const pairs = loadFixturePairs()
  const vectors = new Float32Array(pairs.length * DIMENSION)
  pairs.forEach((_p, i) => vectors.set(oneHot(i), i * DIMENSION))
  return createVectorIndex({ pairs, vectors, dimension: DIMENSION })
}

export type FakeEmbedder = Embedder & { calls: string[][] }

// Messages mentioning a topic embed onto it; anything else lands equidistant
// from every topic (similarity 0.5), below the test threshold.
export function fakeEmbedder({ fail }: { fail?: Error } = {}): FakeEmbedder {
  const calls: string[][] = []
  return {
    calls,
    async embed(texts) {
      calls.push(texts)
      if (fail) throw fail
      return texts.map((text) => {
        const t = TOPICS.findIndex((topic) => text.toLowerCase().includes(topic))
        return t === -1 ? new Float32Array(DIMENSION).fill(0.5) : oneHot(t)
      })
    }
  }
}

export type FakeLlm = LlmClient & { calls: ReplyRequest[] }

export function fakeLlm({ chunks = ['Hello', ' there', '!'], stopReason = 'end_turn', fail }: {
  chunks?: string[]
  stopReason?: string
  fail?: Error
} = {}): FakeLlm {
  const calls: ReplyRequest[] = []
  return {
    calls,
    async* streamReply(request): AsyncGenerator<string, StreamResult, void> {
      calls.push(request)
      for (const chunk of chunks) yield chunk
      if (fail) throw fail
      return { stopReason }
    }
  }
}

export const testConfig: Pick<AppConfig, 'vapi'> = {
  vapi: {
    publicKey: 'pk_test',
    assistantId: '',
    customLlmSecret: 'test-secret',
    publicBaseUrl: 'https://tunnel.example'
  }
}

export function buildTestApp({ embedder = fakeEmbedder(), llm = fakeLlm(), minSimilarity = 0.8 }: {
  embedder?: FakeEmbedder
  llm?: FakeLlm
  minSimilarity?: number
} = {}) {
  const responder = createRagResponder({
    embedder,
    index: fixtureIndex(),
    llm,
    topK: 2,
    minSimilarity,
    effort: { text: 'low', voice: 'low' }
  })
  return { app: createApp({ responder, config: testConfig }), embedder, llm }
}

// Parses an SSE body into its data payloads ('[DONE]' kept as a string).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSse(text: string): any[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => {
      const data = block.slice('data: '.length)
      return data === '[DONE]' ? data : JSON.parse(data)
    })
}
