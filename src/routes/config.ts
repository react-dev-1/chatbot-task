import express from 'express'
import type { VapiConfig } from '../config'

// Only public values: the Vapi public key and where Vapi should send custom-LLM calls.
export function createConfigRouter({ vapi }: { vapi: VapiConfig }): express.Router {
  const router = express.Router()

  router.get('/config', (_req, res) => {
    res.json({
      vapiPublicKey: vapi.publicKey,
      vapiAssistantId: vapi.assistantId,
      customLlmUrl: vapi.publicBaseUrl ? `${vapi.publicBaseUrl}/vapi` : ''
    })
  })

  return router
}
