import request from 'supertest'
import { buildTestApp, fakeEmbedder, fakeLlm, parseSse } from '../fixtures/testDeps'
import { LlmError } from '../llm/claude'
import { VoyageError } from '../embeddings/voyage'

describe('POST /chat', () => {
  test('streams meta, deltas and [DONE] as SSE', async () => {
    const { app, llm } = buildTestApp()

    const res = await request(app).post('/chat').send({ message: 'How do I sort a list in Python?' })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    const events = parseSse(res.text)
    expect(events[0]).toEqual({ meta: { sources: [{ model: 'fixture-model-a', similarity: 1 }] } })
    expect(events.slice(1, -1)).toEqual([{ delta: 'Hello' }, { delta: ' there' }, { delta: '!' }])
    expect(events[events.length - 1]).toBe('[DONE]')

    const call = llm.calls[0]
    expect(call.effort).toBe('low')
    expect(call.system).toMatch(/text chat/)
    const lastTurn = call.messages[call.messages.length - 1]
    expect(lastTurn.content).toContain('<examples>')
    expect(lastTurn.content).toContain('my_list.reverse()')
    expect(lastTurn.content.endsWith('How do I sort a list in Python?')).toBe(true)
  })

  test('sends history before the new message', async () => {
    const { app, llm } = buildTestApp()
    const history = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello! How can I help?' }
    ]

    await request(app).post('/chat').send({ message: 'Tell me about France', history })

    const { messages } = llm.calls[0]
    expect(messages.slice(0, 2)).toEqual(history)
    expect(messages[2].role).toBe('user')
  })

  test('answers without examples when nothing is similar enough', async () => {
    const { app, llm } = buildTestApp()

    const res = await request(app).post('/chat').send({ message: 'What rhymes with orange?' })

    const events = parseSse(res.text)
    expect(events[0]).toEqual({ meta: { sources: [] } })
    expect(llm.calls[0].messages[0].content).toBe('What rhymes with orange?')
  })

  test.each([
    [{}, 'message is required'],
    [{ message: '   ' }, 'message is required'],
    [{ message: 'x'.repeat(1001) }, 'message must be at most 1000 characters'],
    [{ message: 'hi', history: 'nope' }, 'history must be an array'],
    [{ message: 'hi', history: [{ role: 'system', content: 'x' }] }, expect.stringMatching(/^history entries/)]
  ])('rejects invalid body %j with 400', async (body, error) => {
    const { app, llm } = buildTestApp()

    const res = await request(app).post('/chat').send(body)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error })
    expect(llm.calls).toHaveLength(0)
  })

  test('returns 400 JSON for a malformed JSON body', async () => {
    const { app } = buildTestApp()

    const res = await request(app).post('/chat').set('Content-Type', 'application/json').send('{"message":')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid request body' })
  })

  test('sends an error event when Voyage fails', async () => {
    const embedder = fakeEmbedder({ fail: new VoyageError('Voyage returned 503', 503) })
    const { app, llm } = buildTestApp({ embedder })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app).post('/chat').send({ message: 'Python question' })

    expect(parseSse(res.text)).toEqual([
      { error: 'Search is temporarily unavailable. Please try again.' },
      '[DONE]'
    ])
    expect(llm.calls).toHaveLength(0)
    errorSpy.mockRestore()
  })

  test('sends an error event after partial output when Claude fails mid-stream', async () => {
    const llm = fakeLlm({ chunks: ['Partial'], fail: new LlmError('The assistant is temporarily unavailable.', 'unavailable') })
    const { app } = buildTestApp({ llm })

    const res = await request(app).post('/chat').send({ message: 'Python question' })

    const events = parseSse(res.text)
    expect(events.slice(1)).toEqual([
      { delta: 'Partial' },
      { error: 'The assistant is temporarily unavailable.' },
      '[DONE]'
    ])
  })

  test('replaces a refusal with a polite message', async () => {
    const llm = fakeLlm({ chunks: [], stopReason: 'refusal' })
    const { app } = buildTestApp({ llm })

    const res = await request(app).post('/chat').send({ message: 'Python question' })

    const deltas = parseSse(res.text).filter((e) => e.delta)
    expect(deltas).toEqual([{ delta: expect.stringMatching(/^Sorry, I can't help with that one/) }])
  })
})
