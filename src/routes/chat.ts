import express from 'express'
import { validateChatRequest } from '../bot/validation'
import { startSse, sendData, endSse, clientAbortSignal } from '../http/sse'
import { publicErrorMessage } from '../http/errors'
import type { Responder } from '../types'

export function createChatRouter({ responder }: { responder: Responder }): express.Router {
  const router = express.Router()

  router.post('/chat', async (req, res) => {
    const { value, error } = validateChatRequest(req.body)
    if (error !== undefined) {
      res.status(400).json({ error })
      return
    }

    const signal = clientAbortSignal(res)
    startSse(res)
    try {
      for await (const event of responder.respond({ ...value, channel: 'text', signal })) {
        if (event.type === 'meta') sendData(res, { meta: { sources: event.sources } })
        else sendData(res, { delta: event.text })
      }
    } catch (err) {
      if (signal.aborted) {
        res.end()
        return
      }
      sendData(res, { error: publicErrorMessage(err) })
    }
    endSse(res)
  })

  return router
}
