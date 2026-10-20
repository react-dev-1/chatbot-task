import { validateChatRequest, normalizeHistory } from './validation'
import type { ChatTurn } from '../types'

describe('validateChatRequest', () => {
  test('trims the message and defaults history to []', () => {
    expect(validateChatRequest({ message: '  hi  ' })).toEqual({ value: { message: 'hi', history: [] } })
  })

  test('rejects a missing body', () => {
    expect(validateChatRequest(undefined)).toEqual({ error: 'message is required' })
  })
})

describe('normalizeHistory', () => {
  test('starts with user and ends with assistant', () => {
    const history: ChatTurn[] = [
      { role: 'assistant', content: 'greeting' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'unanswered' }
    ]
    expect(normalizeHistory(history)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' }
    ])
  })

  test('merges consecutive same-role turns and drops empty ones', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: '  ' },
      { role: 'assistant', content: 'c' }
    ]
    expect(normalizeHistory(history)).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' }
    ])
  })

  test('keeps only the last 40 turns', () => {
    const history: ChatTurn[] = Array.from({ length: 100 }, (_v, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `t${i}`
    }))
    const result = normalizeHistory(history)
    expect(result).toHaveLength(40)
    expect(result[0].content).toBe('t60')
  })

  test('counts turns after merging fragments, so early context survives', () => {
    // 6 exchanges where each user question arrives as 4 voice fragments.
    const history: ChatTurn[] = []
    for (let i = 0; i < 6; i++) {
      for (let f = 0; f < 4; f++) history.push({ role: 'user', content: `q${i}-part${f}` })
      history.push({ role: 'assistant', content: `a${i}` })
    }
    const result = normalizeHistory(history)
    expect(result).toHaveLength(12)
    expect(result[0].content).toBe('q0-part0\n\nq0-part1\n\nq0-part2\n\nq0-part3')
  })

  test('drops the oldest turns when history is too long in total', () => {
    const big = 'x'.repeat(7000)
    const history: ChatTurn[] = Array.from({ length: 20 }, (_v, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `${i}:${big}`
    }))
    const result = normalizeHistory(history)
    const total = result.reduce((sum, t) => sum + t.content.length, 0)
    expect(total).toBeLessThanOrEqual(40_000)
    expect(result[0].role).toBe('user')
    expect(result[result.length - 1].content.startsWith('19:')).toBe(true)
  })
})
