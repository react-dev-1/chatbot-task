import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createVectorIndex, loadIndex, PAIRS_FILE, VECTORS_FILE, META_FILE } from './vectorIndex'
import { fixtureIndex, loadFixturePairs, DIMENSION } from '../fixtures/testDeps'
import type { Pair } from '../types'

describe('createVectorIndex', () => {
  test('returns top-k matches by cosine similarity, best first', () => {
    const index = fixtureIndex()
    const query = Float32Array.from([0.8, 0.6, 0, 0])

    const results = index.search(query, 2)

    expect(results.map((r) => r.pair.id)).toEqual(['fx-1:0', 'fx-2:0'])
    expect(results[0].similarity).toBeCloseTo(0.8)
    expect(results[1].similarity).toBeCloseTo(0.6)
  })

  test('returns all pairs when k exceeds the index size', () => {
    expect(fixtureIndex().search(new Float32Array(DIMENSION).fill(0.5), 10)).toHaveLength(4)
  })

  test('rejects mismatched sizes', () => {
    const pair = loadFixturePairs()[0] as Pair
    expect(() => createVectorIndex({ pairs: [pair], vectors: new Float32Array(3), dimension: 4 })).toThrow()
    expect(() => fixtureIndex().search(new Float32Array(3), 1)).toThrow('dimension')
  })
})

describe('loadIndex', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmsys-index-'))
    const pairs = loadFixturePairs()
    const vectors = new Float32Array(pairs.length * DIMENSION)
    pairs.forEach((_p, i) => { vectors[i * DIMENSION + i] = 1 })
    fs.writeFileSync(path.join(dir, PAIRS_FILE), pairs.map((p) => JSON.stringify(p)).join('\n') + '\n')
    fs.writeFileSync(path.join(dir, VECTORS_FILE), Buffer.from(vectors.buffer))
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify({ model: 'voyage-test', dimension: DIMENSION, count: pairs.length }))
  })

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('loads pairs and vectors written by ingest', () => {
    const index = loadIndex(dir, { model: 'voyage-test', dimension: DIMENSION })
    expect(index.size).toBe(4)
    expect(index.search(Float32Array.from([0, 0, 1, 0]), 1)[0].pair.id).toBe('fx-3:0')
  })

  test('refuses data embedded with a different model', () => {
    expect(() => loadIndex(dir, { model: 'other', dimension: DIMENSION })).toThrow(/Re-run ingest/)
  })

  test('explains how to create missing data', () => {
    expect(() => loadIndex(path.join(dir, 'nope'), { model: 'voyage-test', dimension: DIMENSION })).toThrow(/npm run ingest/)
  })
})
