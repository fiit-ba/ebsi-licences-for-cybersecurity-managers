// The identity from the phrase alone (design decisions D31).
import { derivationPathFor, isValidPhrase, normalizePhrase, unknownWords } from './recovery'

const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const OTHER = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'

describe('the identity from the recovery phrase', () => {
  it('gives the same path for the same phrase, however it is typed', () => {
    const path = derivationPathFor(PHRASE)
    expect(derivationPathFor(`  ${PHRASE.toUpperCase().replace(/ /g, '   ')}\n`)).toBe(path)
    expect(derivationPathFor(OTHER)).not.toBe(path)
  })

  it('is the identity key path: m/1037171 and seven unhardened indexes', () => {
    const path = derivationPathFor(PHRASE)
    expect(path).toMatch(/^m(\/\d{1,10}){8}$/)
    const [, z, ...rest] = path.split('/')
    expect(z).toBe('1037171')
    expect(rest).toHaveLength(7)
    for (const index of rest) expect(Number(index)).toBeLessThan(2 ** 31)
  })

  it('accepts a phrase with a valid checksum only', () => {
    expect(isValidPhrase(PHRASE)).toBe(true)
    // One word swapped breaks the checksum; one word short is not a phrase.
    expect(isValidPhrase(PHRASE.replace('yellow', 'winner'))).toBe(false)
    expect(isValidPhrase(PHRASE.split(' ').slice(0, 11).join(' '))).toBe(false)
  })

  it('names the words that are not in the list', () => {
    expect(unknownWords(PHRASE)).toEqual([])
    expect(unknownWords('legal winnner thank yaer')).toEqual(['winnner', 'yaer'])
  })

  it('normalises the way the phrase was generated', () => {
    expect(normalizePhrase(' Legal  WINNER\tthank ')).toBe('legal winner thank')
  })
})
