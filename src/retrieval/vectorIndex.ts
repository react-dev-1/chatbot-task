import fs from 'node:fs'
import path from 'node:path'
import type { Match, Pair, VectorIndex } from '../types'

export const PAIRS_FILE = 'lmsys-pairs.jsonl'
export const VECTORS_FILE = 'lmsys-vectors.f32'
export const META_FILE = 'meta.json'

export interface IndexMeta {
  model: string
  dimension: number
  count: number
}

// pairs[i] is described by vectors[i * dimension ... (i + 1) * dimension).
// Vectors must already be L2-normalised, so the dot product is cosine similarity.
export function createVectorIndex({ pairs, vectors, dimension }: {
  pairs: Pair[]
  vectors: Float32Array
  dimension: number
}): VectorIndex {
  if (vectors.length !== pairs.length * dimension) {
    throw new Error(`Vector data has ${vectors.length} floats, expected ${pairs.length} x ${dimension}`)
  }

  function search(query: Float32Array, k: number): Match[] {
    if (query.length !== dimension) {
      throw new Error(`Query has dimension ${query.length}, index has ${dimension}`)
    }
    const top: { i: number, score: number }[] = []
    for (let i = 0; i < pairs.length; i++) {
      const offset = i * dimension
      let score = 0
      for (let d = 0; d < dimension; d++) score += query[d] * vectors[offset + d]
      if (top.length < k) {
        top.push({ i, score })
        top.sort((a, b) => b.score - a.score)
      } else if (score > top[k - 1].score) {
        top[k - 1] = { i, score }
        top.sort((a, b) => b.score - a.score)
      }
    }
    return top.map(({ i, score }) => ({ pair: pairs[i], similarity: score }))
  }

  return { search, size: pairs.length, dimension }
}

export function loadIndex(dataDir: string, { model, dimension }: { model: string, dimension: number }): VectorIndex {
  const metaPath = path.join(dataDir, META_FILE)
  if (!fs.existsSync(metaPath)) {
    throw new Error(`No ingested data in ${dataDir}. Run "npm run ingest" first.`)
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as IndexMeta
  if (meta.model !== model || meta.dimension !== dimension) {
    throw new Error(
      `Data was embedded with ${meta.model}/${meta.dimension} but the server is configured for ` +
      `${model}/${dimension}. Re-run ingest or fix VOYAGE_MODEL / VOYAGE_DIM.`
    )
  }

  const pairs = fs.readFileSync(path.join(dataDir, PAIRS_FILE), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Pair)
  const buf = fs.readFileSync(path.join(dataDir, VECTORS_FILE))
  // Copy into a fresh, 4-byte-aligned buffer before viewing it as floats.
  const vectors = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

  return createVectorIndex({ pairs, vectors, dimension })
}
