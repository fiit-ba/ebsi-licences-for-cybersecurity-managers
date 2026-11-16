// One pass of "Update licenses" over the held certificates says how many statuses
// it could not read, so the button does not claim a current list while offline.
import { base64url } from 'jose'
import { utils } from 'ethers'
import { refreshStoredStatuses } from './checkRevocation'
import { getCredentialsList, markItemStatus } from '@infrastructure/persistence/keychain'

jest.mock('@infrastructure/config/Ebsi', () => ({
  ebsi: {
    isConfigured: () => true,
    didRegistry: () => 'http://ebsi.test/v1/did-registry',
    trustedIssuersRegistry: () => 'http://ebsi.test/v1/issuers-registry',
    trustedSchemasRegistry: () => 'http://ebsi.test/v1/schemas-registry',
    ledger: () => 'http://ebsi.test/v1/ledger',
  },
  certificates: { registry: () => '0x' + 'cc'.repeat(20), chainId: () => 1337 },
  supportOfficeDid: () => 'did:ebsi:zSupportOffice',
}))
jest.mock('@infrastructure/persistence/keychain', () => ({
  getCredentialsList: jest.fn(),
  markItemStatus: jest.fn(async () => undefined),
}))

const fetchMock = jest.fn()
;(global as any).fetch = fetchMock

const CONTRACT = '0x' + 'cc'.repeat(20)
const FROM = 1767225600
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
const registry = new utils.Interface([
  'function certificateStatus(bytes32) view returns (tuple(uint8 standing, uint64 validFrom, uint64 validUntil, uint64 registeredAt, uint64 changedAt, bytes32 credentialHash, string issuerDid))',
])

/** A held registry certificate, as the wallet keeps it: the signed JWT and one disclosure. */
const certificate = (id: number) => {
  const part = (value: unknown) => base64url.encode(JSON.stringify(value))
  const vc = {
    id: `urn:uuid:${id}`,
    issuer: 'did:ebsi:zTi',
    validFrom: iso(FROM),
    credentialSubject: { id: 'did:key:z', certificateNumber: `SK-CSM-${id}` },
    credentialStatus: [{ id: 'x', type: 'PlrLedgerStatusEntry', chainId: 1337, contract: CONTRACT }],
  }
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part({ iss: vc.issuer, vc })}.c2ln~disclosure~`
}
const held = (tokens: string[]) =>
  (getCredentialsList as jest.Mock).mockResolvedValue(
    tokens.map((credential, index) => ({ credential, status: 'Active', timestamp: new Date(1000 + index) })),
  )

describe('refreshing the held licenses', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    ;(markItemStatus as jest.Mock).mockClear()
  })

  it('counts every status it could not read and keeps their last known status', async () => {
    held([certificate(1), certificate(2)])
    fetchMock.mockRejectedValue(new TypeError('Network request failed'))
    await expect(refreshStoredStatuses()).resolves.toEqual({ checked: 2, unchecked: 2 })
    expect(markItemStatus).not.toHaveBeenCalled()
  })

  it('records what it read and reports nothing unchecked', async () => {
    const token = certificate(1)
    held([token])
    const hash = utils.sha256(utils.toUtf8Bytes(token.split('~')[0]))
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        result: registry.encodeFunctionResult('certificateStatus', [[2, FROM, 0, FROM, FROM, hash, 'did:ebsi:zTi']]),
      }),
    })
    await expect(refreshStoredStatuses()).resolves.toEqual({ checked: 1, unchecked: 0 })
    expect(markItemStatus).toHaveBeenCalledWith(new Date(1000), 'credential', 'Suspended')
  })
})
