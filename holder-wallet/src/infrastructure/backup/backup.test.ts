// The encrypted backup (design decisions D31): its keys come back from the
// identity key, it opens only with them and only at its own address, and its
// proof verifies as a plain ES256 JWS - what the back-office checks.
import { createPublicKey, verify } from 'node:crypto'
import { base64url } from 'jose'
import { backupKeys, thumbprint } from './keys'
import { digest, open, proof, PROOF_TYPE, seal } from './envelope'

const IDENTITY = '0x' + '4c'.repeat(32)
const OTHER_IDENTITY = '0x' + '5d'.repeat(32)

describe('the backup keys', () => {
  it('come back from the identity key, and from no other', () => {
    const keys = backupKeys(IDENTITY)
    const again = backupKeys(IDENTITY.slice(2))
    expect(again.backupId).toBe(keys.backupId)
    expect(again.encryptionKey.toString('hex')).toBe(keys.encryptionKey.toString('hex'))
    expect(backupKeys(OTHER_IDENTITY).backupId).not.toBe(keys.backupId)
  })

  it("address the backup by the signing key's thumbprint, and say nothing of the identity", () => {
    const keys = backupKeys(IDENTITY)
    expect(keys.backupId).toBe(thumbprint(keys.publicJwk))
    expect(keys.backupId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(keys.publicJwk)).not.toContain('4c4c')
  })
})

describe('the sealed backup', () => {
  const keys = backupKeys(IDENTITY)

  it('opens with its keys', () => {
    const text = JSON.stringify({ credentials: [{ id: 'urn:uuid:1', credential: 'eyJ…' }] })
    expect(open(keys, seal(keys, text))).toBe(text)
  })

  it('is different each time it is sealed', () => {
    expect(seal(keys, 'same')).not.toBe(seal(keys, 'same'))
  })

  it("does not open with another wallet's keys", () => {
    expect(() => open(backupKeys(OTHER_IDENTITY), seal(keys, 'secret'))).toThrow()
  })

  it('does not open once changed', () => {
    const sealed = base64url.decode(seal(keys, 'secret'))
    sealed[sealed.length - 1] ^= 1
    expect(() => open(keys, base64url.encode(sealed))).toThrow()
  })

  it('does not open at another address', () => {
    const moved = { ...keys, backupId: backupKeys(OTHER_IDENTITY).backupId }
    expect(() => open(moved, seal(keys, 'secret'))).toThrow()
  })
})

describe("the upload's proof", () => {
  const keys = backupKeys(IDENTITY)

  it('is an ES256 JWS by the backup key over the address, version and digest', () => {
    const ciphertext = seal(keys, 'wallet')
    const token = proof(keys, { version: 7, digest: digest(ciphertext) }, 1_800_000_000_000)
    const [header, payload, signature] = token.split('.')
    const decodedHeader = JSON.parse(Buffer.from(base64url.decode(header)).toString())
    expect(decodedHeader).toEqual({ alg: 'ES256', typ: PROOF_TYPE, jwk: keys.publicJwk })
    expect(JSON.parse(Buffer.from(base64url.decode(payload)).toString())).toEqual({
      backup: keys.backupId,
      iat: 1_800_000_000,
      version: 7,
      digest: digest(ciphertext),
    })
    const publicKey = createPublicKey({ key: keys.publicJwk as any, format: 'jwk' })
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`) as any,
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      base64url.decode(signature) as any,
    )
    expect(valid).toBe(true)
  })
})
