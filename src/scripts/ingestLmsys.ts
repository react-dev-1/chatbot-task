// Downloads a filtered English subset of LMSYS-Chat-1M, embeds the prompts with
// Voyage and writes data/lmsys-pairs.jsonl, data/lmsys-vectors.f32 and data/meta.json.
// Safe to re-run: it resumes from data/ingest-state.json.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../config'
import { createVoyageClient } from '../embeddings/voyage'
import { extractPairs, normalizePrompt } from '../ingest/filters'
import type { LmsysRow } from '../ingest/filters'
import { PAIRS_FILE, VECTORS_FILE, META_FILE } from '../retrieval/vectorIndex'
import type { Pair } from '../types'

// /rows needs no server-side search index (unlike /filter), so it works as soon
// as the dataset is reachable. Language filtering happens locally in extractPairs.
const HF_ROWS_URL = 'https://datasets-server.huggingface.co/rows'
const PAGE_SIZE = 100
// 64 prompts of at most 500 characters stay under Voyage's 10K tokens/minute
// limit for accounts without a payment method.
const EMBED_BATCH = 64
const STATE_FILE = 'ingest-state.json'

interface RowsPage {
  rows?: { row: LmsysRow, truncated_cells?: string[] }[]
}

interface IngestState {
  model: string
  dimension: number
  offset: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchPage(token: string, offset: number): Promise<RowsPage> {
  const params = new URLSearchParams({
    dataset: 'lmsys/lmsys-chat-1m',
    config: 'default',
    split: 'train',
    offset: String(offset),
    length: String(PAGE_SIZE)
  })
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HF_ROWS_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return await res.json() as RowsPage
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    const detail = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Hugging Face denied access (${res.status}). Accept the dataset terms at https://huggingface.co/datasets/lmsys/lmsys-chat-1m and check HF_TOKEN.`)
    }
    throw new Error(`Hugging Face returned ${res.status}: ${detail.slice(0, 200)}`)
  }
}

// Makes the pairs and vectors files agree after an interrupted run, and returns
// the normalised prompts already stored (for de-duplication).
function reconcile(dataDir: string, dimension: number): string[] {
  const pairsPath = path.join(dataDir, PAIRS_FILE)
  const vectorsPath = path.join(dataDir, VECTORS_FILE)
  const lines = fs.existsSync(pairsPath) ? fs.readFileSync(pairsPath, 'utf8').split('\n').filter(Boolean) : []
  const vectorRows = fs.existsSync(vectorsPath) ? Math.floor(fs.statSync(vectorsPath).size / (dimension * 4)) : 0
  const count = Math.min(lines.length, vectorRows)
  const kept = lines.slice(0, count)
  fs.writeFileSync(pairsPath, kept.length ? `${kept.join('\n')}\n` : '')
  if (fs.existsSync(vectorsPath)) fs.truncateSync(vectorsPath, count * dimension * 4)
  else fs.writeFileSync(vectorsPath, Buffer.alloc(0))
  return kept.map((line) => normalizePrompt((JSON.parse(line) as Pair).prompt))
}

async function main(): Promise<void> {
  const config = loadConfig()
  const token = process.env.HF_TOKEN
  if (!token) throw new Error('HF_TOKEN is not set')
  const maxPairs = Number.parseInt(process.env.LMSYS_MAX_PAIRS || '20000', 10)
  const { dataDir } = config
  const { model, dimension } = config.voyage
  // Patient retries: a rate-limited account may need to wait out a full minute.
  const voyage = createVoyageClient({ ...config.voyage, maxRetries: 10, baseDelayMs: 5000 })

  fs.mkdirSync(dataDir, { recursive: true })
  const statePath = path.join(dataDir, STATE_FILE)
  let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) as IngestState : null
  if (state && (state.model !== model || state.dimension !== dimension)) {
    throw new Error(`Existing data uses ${state.model}/${state.dimension}. Delete ${dataDir} to re-ingest with ${model}/${dimension}.`)
  }
  if (!state) {
    for (const f of [PAIRS_FILE, VECTORS_FILE]) fs.rmSync(path.join(dataDir, f), { force: true })
    state = { model, dimension, offset: 0 }
  }

  const seen = new Set(reconcile(dataDir, dimension))
  let count = seen.size
  const writeMeta = () => fs.writeFileSync(path.join(dataDir, META_FILE), JSON.stringify({ model, dimension, count }, null, 2))
  writeMeta()
  console.log(`Starting at row offset ${state.offset} with ${count} pairs already stored`)

  while (count < maxPairs) {
    const page = await fetchPage(token, state.offset)
    if (!page.rows || page.rows.length === 0) break

    const fresh: Pair[] = []
    for (const { row, truncated_cells: truncated } of page.rows) {
      if (truncated && truncated.length) continue
      for (const pair of extractPairs(row)) {
        const key = normalizePrompt(pair.prompt)
        if (seen.has(key)) continue
        seen.add(key)
        fresh.push(pair)
      }
    }
    const batch = fresh.slice(0, maxPairs - count)

    for (let i = 0; i < batch.length; i += EMBED_BATCH) {
      const slice = batch.slice(i, i + EMBED_BATCH)
      const vectors = await voyage.embed(slice.map((p) => p.prompt))
      const buf = Buffer.alloc(slice.length * dimension * 4)
      vectors.forEach((v, j) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).copy(buf, j * dimension * 4))
      // Vectors first, then pairs: reconcile() trims any partial write on the next run.
      fs.appendFileSync(path.join(dataDir, VECTORS_FILE), buf)
      fs.appendFileSync(path.join(dataDir, PAIRS_FILE), slice.map((p) => JSON.stringify(p)).join('\n') + '\n')
      count += slice.length
    }

    state.offset += page.rows.length
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    writeMeta()
    console.log(`offset ${state.offset}: ${count}/${maxPairs} pairs`)
    if (page.rows.length < PAGE_SIZE) break
  }

  console.log(`Done: ${count} pairs in ${dataDir}`)
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
