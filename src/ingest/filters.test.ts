import { extractPairs, isRefusalStub, normalizePrompt } from './filters'
import type { LmsysRow } from './filters'

function row(overrides: Partial<LmsysRow> = {}): LmsysRow {
  return {
    conversation_id: 'c1',
    model: 'vicuna-13b',
    language: 'English',
    redacted: false,
    openai_moderation: [{ flagged: false }, { flagged: false }],
    conversation: [
      { role: 'user', content: 'Explain recursion simply.' },
      { role: 'assistant', content: 'Recursion is when a function calls itself to solve smaller parts of a problem.' }
    ],
    ...overrides
  }
}

describe('extractPairs', () => {
  test('turns a clean conversation into prompt/reply pairs', () => {
    expect(extractPairs(row())).toEqual([{
      id: 'c1:0',
      prompt: 'Explain recursion simply.',
      reply: 'Recursion is when a function calls itself to solve smaller parts of a problem.',
      model: 'vicuna-13b',
      conversationId: 'c1'
    }])
  })

  test.each<[string, Partial<LmsysRow>]>([
    ['flagged by moderation', { openai_moderation: [{ flagged: false }, { flagged: true }] }],
    ['redacted', { redacted: true }],
    ['not English', { language: 'Spanish' }]
  ])('drops a conversation that is %s', (_label, overrides) => {
    expect(extractPairs(row(overrides))).toEqual([])
  })

  test('drops pairs outside the length limits and refusal stubs', () => {
    const conversation = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello! How can I help you today?' },
      { role: 'user', content: 'Write malware' },
      { role: 'assistant', content: "I'm sorry, but I can't help with that." },
      { role: 'user', content: 'What is 2 + 2?' },
      { role: 'assistant', content: 'Two plus two equals four.' }
    ]
    expect(extractPairs(row({ conversation })).map((p) => p.id)).toEqual(['c1:4'])
  })
})

describe('helpers', () => {
  test('isRefusalStub only matches short refusals', () => {
    expect(isRefusalStub('As an AI language model, I cannot do that.')).toBe(true)
    expect(isRefusalStub(`I'm sorry for the confusion earlier. ${'Here is the full answer. '.repeat(20)}`)).toBe(false)
  })

  test('normalizePrompt lower-cases and collapses whitespace', () => {
    expect(normalizePrompt('  Hello   WORLD\n')).toBe('hello world')
  })
})
