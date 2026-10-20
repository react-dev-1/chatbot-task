// Browser code for the minimal UI. Compiled by web/tsconfig.json to dist/public/app.js.

interface Source {
  model: string
  similarity: number
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface SsePayload {
  meta?: { sources: Source[] }
  delta?: string
  error?: string
}

interface PublicConfig {
  vapiPublicKey: string
  vapiAssistantId: string
  customLlmUrl: string
}

// The parts of the Vapi Web SDK (v2) this page uses.
interface VapiMessage {
  type: string
  role?: string
  transcript?: string
  transcriptType?: string
}

interface VapiClient {
  start(assistant: string | object): Promise<unknown>
  stop(): void
  on(event: 'call-start' | 'call-end', handler: () => void): void
  on(event: 'error', handler: (err: unknown) => void): void
  on(event: 'message', handler: (msg: VapiMessage) => void): void
}

type VapiConstructor = new (publicKey: string) => VapiClient

const VAPI_SDK_URL: string = 'https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.7.1/+esm'
// Must match MAX_HISTORY_TURNS on the server (src/bot/validation.ts).
const MAX_HISTORY = 40

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

const log = byId<HTMLDivElement>('log')
const form = byId<HTMLFormElement>('form')
const input = byId<HTMLInputElement>('input')
const sendButton = byId<HTMLButtonElement>('send')
const callButton = byId<HTMLButtonElement>('call')
const status = byId<HTMLSpanElement>('status')

// Text-chat history sent with each request (voice history is kept by Vapi).
const history: ChatTurn[] = []

// The voice bubble that new transcript fragments from the same speaker extend.
let voiceBubble: { role: 'user' | 'assistant', el: HTMLDivElement } | null = null

function addMessage(role: 'user' | 'assistant', text: string, extraClass = ''): HTMLDivElement {
  voiceBubble = null
  const el = document.createElement('div')
  el.className = `msg ${role} ${extraClass}`.trim()
  el.textContent = text
  log.appendChild(el)
  log.scrollTop = log.scrollHeight
  return el
}

// Vapi sends one final transcript per speech segment; keep a speaker's
// consecutive segments in one bubble until the other side speaks.
function addVoiceTranscript(role: 'user' | 'assistant', text: string): void {
  if (voiceBubble && voiceBubble.role === role) {
    voiceBubble.el.textContent = `${voiceBubble.el.textContent} ${text}`
    log.scrollTop = log.scrollHeight
    return
  }
  const el = addMessage(role, text, 'voice')
  voiceBubble = { role, el }
}

function showSources(el: HTMLElement, sources: Source[]): void {
  if (!sources.length) return
  const models = [...new Set(sources.map((s) => s.model))].join(', ')
  const note = document.createElement('span')
  note.className = 'sources'
  note.textContent = `Reference examples from: ${models}`
  el.appendChild(note)
}

async function sendMessage(message: string): Promise<void> {
  addMessage('user', message)
  const bubble = addMessage('assistant', '…')
  const textNode = document.createTextNode('')
  let reply = ''
  let sources: Source[] = []
  let failed = false

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-MAX_HISTORY) })
    })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || `Request failed (${res.status})`)
    }

    bubble.textContent = ''
    bubble.appendChild(textNode)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        const data = event.replace(/^data: /, '')
        if (data === '[DONE]') continue
        const payload = JSON.parse(data) as SsePayload
        if (payload.meta) sources = payload.meta.sources
        if (payload.delta) {
          reply += payload.delta
          textNode.textContent = reply
          log.scrollTop = log.scrollHeight
        }
        if (payload.error) {
          failed = true
          bubble.classList.add('error')
          textNode.textContent = reply ? `${reply}\n\n${payload.error}` : payload.error
        }
      }
    }
  } catch (err) {
    failed = true
    bubble.classList.add('error')
    bubble.textContent = (err as Error).message
  }

  if (!failed && reply) {
    showSources(bubble, sources)
    history.push({ role: 'user', content: message }, { role: 'assistant', content: reply })
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const message = input.value.trim()
  if (!message) return
  input.value = ''
  sendButton.disabled = true
  try {
    await sendMessage(message)
  } finally {
    sendButton.disabled = false
    input.focus()
  }
})

// ---- Voice (Vapi) ----

// Edit voice and transcriber here (or use a saved assistant via VAPI_ASSISTANT_ID).
function inlineAssistant(customLlmUrl: string): object {
  return {
    name: 'LMSYS voice bot',
    firstMessage: 'Hi! What would you like to know?',
    model: { provider: 'custom-llm', url: customLlmUrl, model: 'lmsys-rag' },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'en' },
    voice: { provider: 'vapi', voiceId: 'Elliot' },
    maxDurationSeconds: 600
  }
}

async function setUpVoice(): Promise<void> {
  const config = await fetch('/config').then((r) => r.json()) as PublicConfig
  const assistant = config.vapiAssistantId || (config.customLlmUrl && inlineAssistant(config.customLlmUrl))
  if (!config.vapiPublicKey || !assistant) {
    status.textContent = 'Voice not configured'
    return
  }

  // jsDelivr's +esm build of this CommonJS package exports the CJS `exports`
  // object as default, so the class is at default.default.
  const mod = await import(VAPI_SDK_URL) as { default: VapiConstructor | { default: VapiConstructor } }
  const Vapi = typeof mod.default === 'function' ? mod.default : mod.default.default
  const vapi = new Vapi(config.vapiPublicKey)
  let active = false

  const setActive = (on: boolean) => {
    active = on
    callButton.disabled = false
    callButton.classList.toggle('active', on)
    callButton.textContent = on ? 'End call' : 'Start call'
    status.textContent = on ? 'On a call' : ''
  }

  vapi.on('call-start', () => setActive(true))
  vapi.on('call-end', () => {
    voiceBubble = null
    setActive(false)
  })
  vapi.on('error', (err) => {
    console.error(err)
    status.textContent = 'Voice error'
    setActive(false)
  })
  vapi.on('message', (msg) => {
    if (msg.type === 'transcript' && msg.transcriptType === 'final' && msg.transcript) {
      addVoiceTranscript(msg.role === 'user' ? 'user' : 'assistant', msg.transcript)
    }
  })

  callButton.addEventListener('click', async () => {
    callButton.disabled = true
    if (active) {
      vapi.stop()
      return
    }
    status.textContent = 'Connecting…'
    try {
      await vapi.start(assistant)
    } catch (err) {
      console.error(err)
      status.textContent = 'Could not start the call'
      callButton.disabled = false
    }
  })

  callButton.disabled = false
}

setUpVoice().catch((err) => {
  console.error('Voice setup failed:', err)
  status.textContent = 'Voice unavailable'
})

export {}
