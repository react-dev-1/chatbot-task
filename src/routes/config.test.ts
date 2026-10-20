import request from 'supertest'
import { buildTestApp } from '../fixtures/testDeps'

describe('GET /config', () => {
  test('returns only public voice settings', async () => {
    const { app } = buildTestApp()

    const res = await request(app).get('/config')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      vapiPublicKey: 'pk_test',
      vapiAssistantId: '',
      customLlmUrl: 'https://tunnel.example/vapi'
    })
    expect(JSON.stringify(res.body)).not.toContain('test-secret')
  })

  test('serves the UI at /', async () => {
    const { app } = buildTestApp()

    const res = await request(app).get('/')

    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>LMSYS Chat</title>')
  })
})
