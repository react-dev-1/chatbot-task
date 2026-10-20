import { createVoyageClient, VoyageError } from './voyage'

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

const options = { apiKey: 'k', model: 'voyage-test', dimension: 2, baseDelayMs: 0 }

describe('createVoyageClient', () => {
  test('sends the model and dimension, and returns normalised vectors in input order', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => response(200, {
      data: [
        { index: 1, embedding: [0, 2] },
        { index: 0, embedding: [3, 4] }
      ]
    }))
    const client = createVoyageClient({ ...options, fetchImpl })

    const [a, b] = await client.embed(['first', 'second'])

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.voyageai.com/v1/embeddings')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(init?.body as string)).toEqual({ input: ['first', 'second'], model: 'voyage-test', output_dimension: 2 })
    expect(Array.from(a)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
    expect(Array.from(b)).toEqual([0, 1])
  })

  test('retries on 429 then succeeds', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(response(429, {}))
      .mockResolvedValueOnce(response(200, { data: [{ index: 0, embedding: [1, 0] }] }))
    const client = createVoyageClient({ ...options, fetchImpl })

    await expect(client.embed(['x'])).resolves.toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test('does not retry a 400', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => response(400, { detail: 'bad' }))
    const client = createVoyageClient({ ...options, fetchImpl })

    await expect(client.embed(['x'])).rejects.toBeInstanceOf(VoyageError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('requires an API key', () => {
    expect(() => createVoyageClient({ ...options, apiKey: '' })).toThrow('VOYAGE_API_KEY')
  })
})
