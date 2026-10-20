import request from 'supertest'
import { buildTestApp, fakeLlm, parseSse } from '../fixtures/testDeps'

const AUTH = 'Bearer test-secret'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentOf(events: any[]): string {
  return events
    .filter((e) => e !== '[DONE]')
    .map((e) => e.choices[0].delta.content || '')
    .join('')
}

describe('POST /vapi/chat/completions', () => {
  test('streams OpenAI-style chunks ending with stop and [DONE]', async () => {
    const { app, llm } = buildTestApp()

    const res = await request(app)
      .post('/vapi/chat/completions')
      .set('Authorization', AUTH)
      .send({
        model: 'lmsys-rag',
        stream: true,
        messages: [
          { role: 'system', content: 'Vapi default prompt, should be ignored' },
          { role: 'assistant', content: 'Hi! What would you like to know?' },
          { role: 'user', content: 'What is the capital of France?' }
        ]
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    const events = parseSse(res.text)
    expect(events[0].choices[0].delta).toEqual({ role: 'assistant' })
    expect(events.every((e) => e === '[DONE]' || e.object === 'chat.completion.chunk')).toBe(true)
    expect(contentOf(events)).toBe('Hello there!')
    expect(events[events.length - 2].choices[0].finish_reason).toBe('stop')
    expect(events[events.length - 1]).toBe('[DONE]')

    const call = llm.calls[0]
    expect(call.system).toMatch(/voice call/)
    expect(call.system).not.toMatch(/Vapi default prompt/)
    // A leading assistant greeting can't start a Messages API conversation, so it is dropped.
    expect(call.messages).toHaveLength(1)
    expect(call.messages[0].content).toContain('The capital of France is Paris.')
  })

  test('keeps earlier turns as history', async () => {
    const { app, llm } = buildTestApp()

    await request(app)
      .post('/vapi/chat/completions')
      .set('Authorization', AUTH)
      .send({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'And Python?' }
        ]
      })

    const { messages } = llm.calls[0]
    expect(messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ])
  })

  test('removes code and Markdown before speech', async () => {
    const llm = fakeLlm({ chunks: ['Try **this**:\n``', '`python\nprint(1)\n``', '`\nDone.'] })
    const { app } = buildTestApp({ llm })

    const res = await request(app)
      .post('/vapi/chat/completions')
      .set('Authorization', AUTH)
      .send({ messages: [{ role: 'user', content: 'Python code please' }] })

    const spoken = contentOf(parseSse(res.text))
    expect(spoken).not.toMatch(/print\(1\)|`|\*/)
    expect(spoken).toContain('this')
    expect(spoken).toContain('I will skip reading the code aloud.')
    expect(spoken).toContain('Done.')
  })

  test('accepts the secret without a Bearer prefix', async () => {
    const { app } = buildTestApp()

    const res = await request(app)
      .post('/vapi/chat/completions')
      .set('Authorization', 'test-secret')
      .send({ messages: [{ role: 'user', content: 'hi' }] })

    expect(res.status).toBe(200)
  })

  test.each([
    ['no header', undefined],
    ['wrong secret', 'Bearer nope'],
    ['wrong scheme', 'Basic test-secret']
  ])('returns 401 with %s', async (_label, header) => {
    const { app, llm } = buildTestApp()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const req = request(app).post('/vapi/chat/completions')
    if (header) req.set('Authorization', header)

    const res = await req.send({ messages: [{ role: 'user', content: 'hi' }] })

    expect(res.status).toBe(401)
    expect(llm.calls).toHaveLength(0)
    warnSpy.mockRestore()
  })

  test('returns 400 when there is no user message', async () => {
    const { app } = buildTestApp()

    const res = await request(app)
      .post('/vapi/chat/completions')
      .set('Authorization', AUTH)
      .send({ messages: [{ role: 'system', content: 'x' }] })

    expect(res.status).toBe(400)
  })
})
