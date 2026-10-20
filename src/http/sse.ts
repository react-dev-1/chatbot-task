import type { Response } from 'express'

// Minimal SSE helpers. Each write goes straight to the socket; never put a
// buffering middleware (e.g. compression) in front of a route that uses these.
export function startSse(res: Response): void {
  res.status(200)
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()
}

export function sendData(res: Response, data: unknown): void {
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
}

export function endSse(res: Response): void {
  sendData(res, '[DONE]')
  res.end()
}

// AbortSignal that fires when the client goes away before the stream ends.
export function clientAbortSignal(res: Response): AbortSignal {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller.signal
}
