const CODE_NOTICE = ' I will skip reading the code aloud. '

function cleanInline(text: string): string {
  return text
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/\*+/g, '')
    .replace(/(^|\n)[ \t]*(#{1,6}|>|[-+])[ \t]+/g, '$1')
}

export interface SpeechFilter {
  push(delta: string): string
  flush(): string
}

// Streaming filter for voice: removes fenced code blocks and Markdown markup from
// text deltas before they are spoken. Fences can be split across deltas, so a
// trailing run of backticks is held back until the next push.
export function createSpeechFilter(): SpeechFilter {
  let buffer = ''
  let inFence = false

  function drain(final: boolean): string {
    let out = ''
    for (;;) {
      const fence = buffer.indexOf('```')
      if (fence === -1) break
      if (!inFence) out += cleanInline(buffer.slice(0, fence)) + CODE_NOTICE
      buffer = buffer.slice(fence + 3)
      inFence = !inFence
    }

    let keep = 0
    if (!final) {
      const trailing = buffer.match(/`{1,2}$/)
      keep = trailing ? trailing[0].length : 0
    }
    const ready = buffer.slice(0, buffer.length - keep)
    buffer = buffer.slice(buffer.length - keep)
    if (!inFence) out += cleanInline(ready)
    return out
  }

  return {
    push(delta) {
      buffer += delta
      return drain(false)
    },
    flush() {
      return drain(true)
    }
  }
}
