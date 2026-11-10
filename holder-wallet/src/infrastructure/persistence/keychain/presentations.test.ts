let mockStoredData: Record<string, unknown> = {}

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => ({
    username: 'VaccinesData',
    password: JSON.stringify(mockStoredData),
  })),
  setGenericPassword: jest.fn(async (_username: string, password: string) => {
    mockStoredData = JSON.parse(password)
    return { service: 'test' }
  }),
}))

import {
  getActionLogs,
  getPresentationList,
  revokePresentations,
  savePresentation,
} from '@infrastructure/persistence/keychain'

const jwt = (payload: Record<string, unknown>): string => {
  const encoded = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encoded({ alg: 'ES256', typ: 'JWT' })}.${encoded(payload)}.signature`
}

describe('presentation history', () => {
  beforeEach(() => {
    mockStoredData = {}
    jest.setSystemTime(new Date('2026-10-08T12:00:00.000Z'))
  })

  it('stores repeated disclosure of one credential as distinct VP events', async () => {
    const credential = jwt({
      vc: {
        id: 'credential-121',
        issuer: 'did:ebsi:issuer',
        type: ['VerifiableCredential', 'CybersecurityManagerCertificate'],
      },
    })
    const first = jwt({
      aud: 'https://verifier.example',
      iat: 1_791_447_600,
      exp: 1_791_448_500,
      vp: {
        id: 'urn:uuid:presentation-one',
        type: ['VerifiablePresentation'],
        verifiableCredential: [credential],
      },
    })
    const second = jwt({
      aud: 'https://verifier.example',
      iat: 1_791_447_660,
      exp: 1_791_448_560,
      vp: {
        id: 'urn:uuid:presentation-two',
        type: ['VerifiablePresentation'],
        verifiableCredential: [credential],
      },
    })

    await savePresentation(first)
    await savePresentation(second)

    const presentations = await getPresentationList()
    expect(presentations).toHaveLength(2)
    expect(presentations.map(({ id }) => id).sort()).toEqual(['urn:uuid:presentation-one', 'urn:uuid:presentation-two'])
    expect(presentations[0]).toMatchObject({
      verifier: 'https://verifier.example',
      credentialCount: 1,
      credentialTypes: ['CybersecurityManagerCertificate'],
      legacy: false,
    })
  })

  it('does not store the same signed VP event twice', async () => {
    const credential = jwt({
      vc: {
        id: 'credential-121',
        issuer: 'did:ebsi:issuer',
        type: ['VerifiableCredential', 'CybersecurityManagerCertificate'],
      },
    })
    const presentation = jwt({
      aud: 'https://verifier.example',
      vp: {
        id: 'urn:uuid:one-exchange',
        type: ['VerifiablePresentation'],
        verifiableCredential: [credential],
      },
    })

    expect(await savePresentation(presentation)).toBe(true)
    expect(await savePresentation(presentation)).toBe(false)
    expect(await getPresentationList()).toHaveLength(1)
  })

  it('revokes a large selection in one stored update', async () => {
    const credential = jwt({
      vc: {
        id: 'credential-121',
        issuer: 'did:ebsi:issuer',
        type: ['VerifiableCredential', 'CybersecurityManagerCertificate'],
      },
    })
    const presentationIds = Array.from({ length: 12 }, (_, index) =>
      jwt({
        aud: 'https://verifier.example',
        vp: {
          id: `urn:uuid:batch-${index}`,
          type: ['VerifiablePresentation'],
          verifiableCredential: [credential],
        },
      }),
    )

    for (const presentation of presentationIds) await savePresentation(presentation)
    const stored = await getPresentationList()
    const selected = stored.map(({ timestamp }) => timestamp)

    jest.setSystemTime(new Date('2026-10-08T13:00:00.000Z'))
    expect(await revokePresentations(selected)).toHaveLength(12)
    expect(await getPresentationList()).toHaveLength(0)
    const revocation = (await getActionLogs()).find(({ actionType }) => actionType === 'Presentation revoked')
    expect(new Date(revocation!.date).toISOString()).toBe('2026-10-08T13:00:00.000Z')
  })
})
