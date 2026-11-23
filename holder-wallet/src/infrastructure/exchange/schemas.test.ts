// The registry's own schemas (/schemas at the repository's root), as the wallet's verifier
// validates a licence with them: each together with EBSI's Verifiable Attestation it extends.
import fs from 'node:fs'
import path from 'node:path'
import { schemaValidator } from './verify'

jest.mock('@infrastructure/config/Ebsi', () => ({
  ebsi: {},
  issuersRegistryMarkers: [],
  certificates: {},
  supportOfficeDid: () => '',
}))

const schemas = path.resolve(__dirname, '../../../../schemas')
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(schemas, file), 'utf8'))
const attestation = read('ebsi/zH74MKkYTbQ6ZfTxufi6A3Aw8giS4piGm8dpgxFmkJjmu.json')
const licence = read('cybersecurity-manager-licence/1.0.0/schema.json')
const statusEntry = read('licence-status-entry/1.0.0/schema.json')
const example = read('cybersecurity-manager-licence/1.0.0/example.json')
const ledgerEntry = example.credentialStatus[0]

// The licence schema includes the status entry schema; both name their schemas by registry address.
const [attestationAddress, statusEntryAddress] = licence.allOf
  .map((part: { $ref?: string }) => part.$ref)
  .filter(Boolean)

const valid = (schema: any, credential: object) => {
  const validator = schemaValidator()
  const { $schema: _draft, ...base } = attestation
  const { $schema: _entry, ...entry } = statusEntry
  validator.addSchema(base, attestationAddress)
  validator.addSchema(entry, statusEntryAddress)
  const { $schema: _own, ...rules } = schema
  return validator.validate(credential, rules).valid
}

describe("the registry's schemas", () => {
  it('accept their example licence', () => {
    expect(valid(licence, example)).toBe(true)
    expect(valid(statusEntry, example)).toBe(true)
  })

  it('take dates as dates', () => {
    const credential = { ...example, credentialSubject: { ...example.credentialSubject, issueDate: '17.11.2026' } }
    expect(valid(licence, credential)).toBe(false)
  })

  it('want exactly one PlrLedgerStatusEntry, with other status entries beside it allowed', () => {
    const other = { id: 'https://status.example/1#5', type: 'StatusList2021Entry' }
    expect(valid(statusEntry, { ...example, credentialStatus: [ledgerEntry, other] })).toBe(true)
    expect(valid(statusEntry, { ...example, credentialStatus: [other] })).toBe(false)
    expect(valid(statusEntry, { ...example, credentialStatus: [ledgerEntry, ledgerEntry] })).toBe(false)
  })

  it("require the licence's expiry and its PlrLedgerStatusEntry", () => {
    const { expirationDate: _expiry, ...withoutExpiry } = example
    const { credentialStatus: _status, ...withoutStatus } = example
    const other = { id: 'https://status.example/1#5', type: 'StatusList2021Entry' }
    expect(valid(licence, withoutExpiry)).toBe(false)
    expect(valid(licence, withoutStatus)).toBe(false)
    expect(valid(licence, { ...example, credentialStatus: [] })).toBe(false)
    expect(valid(licence, { ...example, credentialStatus: [other] })).toBe(false)
  })

  it('accept the status entry the development ledger names', () => {
    const contract = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
    const entry = { id: `eip155:1337:${contract}`, type: 'PlrLedgerStatusEntry', chainId: 1337, contract }
    expect(valid(statusEntry, { ...example, credentialStatus: [entry] })).toBe(true)
  })
})
