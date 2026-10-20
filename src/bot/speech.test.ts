import { createSpeechFilter } from './speech'

function run(deltas: string[]): string {
  const filter = createSpeechFilter()
  return deltas.map((d) => filter.push(d)).join('') + filter.flush()
}

describe('createSpeechFilter', () => {
  test('passes plain sentences through unchanged', () => {
    expect(run(['Hello ', 'there. ', 'How are you?'])).toBe('Hello there. How are you?')
  })

  test('drops fenced code, even when fences are split across deltas', () => {
    const out = run(['Here:\n`', '``js\nconst x = 1\n', '``', '`\nThat is it.'])
    expect(out).not.toMatch(/const x|`/)
    expect(out).toContain('I will skip reading the code aloud.')
    expect(out).toContain('That is it.')
  })

  test('removes Markdown markup and links', () => {
    const out = run(['## Title\n- **bold** item\nSee [the docs](https://x.y/z) or https://a.b/c'])
    expect(out).toBe('Title\nbold item\nSee the docs or the link')
  })

  test('keeps hyphens and hashes inside sentences', () => {
    expect(run(['5 - 3 is 2 and C# is a language'])).toBe('5 - 3 is 2 and C# is a language')
  })

  test('drops an unterminated code block at the end', () => {
    expect(run(['Code:\n```\nnever spoken'])).not.toContain('never spoken')
  })
})
