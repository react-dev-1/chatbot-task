import path from 'node:path'
import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { createChatRouter } from './routes/chat'
import { createVapiRouter } from './routes/vapi'
import { createConfigRouter } from './routes/config'
import type { AppConfig } from './config'
import type { Responder } from './types'

// Same path whether running from src/ (tests) or dist/ (built server).
const ROOT = path.join(__dirname, '..')

// Malformed JSON bodies and other errors: JSON instead of Express's HTML page.
const jsonErrors: ErrorRequestHandler = (err, _req, res, _next) => {
  const status: number = err.status || err.statusCode || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Invalid request body' })
}

export function createApp({ responder, config }: { responder: Responder, config: Pick<AppConfig, 'vapi'> }): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb' }))
  app.use(express.static(path.join(ROOT, 'public')))
  app.use(express.static(path.join(ROOT, 'dist', 'public')))

  app.use(createChatRouter({ responder }))
  app.use(createVapiRouter({ responder, secret: config.vapi.customLlmSecret }))
  app.use(createConfigRouter({ vapi: config.vapi }))
  app.use(jsonErrors)

  return app
}
