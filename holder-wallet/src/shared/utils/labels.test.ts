// Names for certificate types and claims: attributes by their schema only.

jest.mock('@app/localization/Language', () => {
  let language = 'sk'
  return {
    __setLanguage: (next: string) => {
      language = next
    },
    inLanguage: (texts: Record<string, string | undefined>) => texts[language] ?? texts.sk,
  }
})

import { applySchemaNames } from '@domain/credentials/schemaCatalog'
import { claimLabel, credentialTypeName, inClaimOrder } from '@shared/utils/labels'

const setLanguage = (language: string) => (require('@app/localization/Language') as any).__setLanguage(language)

const SCHEMAS = [
  {
    credential_type: 'IncidentHandlerCertificate',
    name: { sk: 'Riešiteľ kybernetických incidentov', en: 'Cyber incident handler' },
    labels: {
      practicalHours: { sk: 'Počet hodín praxe', en: 'Practical hours' },
      holderName: { sk: 'Iný názov', en: 'Other name' },
      examDate: { sk: 'Dátum skúšky', en: '' },
    },
  },
  { credential_type: 'Broken', name: { en: 'no Slovak' }, labels: { bad: null } },
]

describe('labels', () => {
  beforeEach(() => {
    setLanguage('sk')
    applySchemaNames([])
  })

  it('shows an unknown type and claim as their identifiers without schema names', () => {
    expect(credentialTypeName('IncidentHandlerCertificate')).toBe('Incident Handler Certificate')
    expect(claimLabel('practicalHours')).toBe('practical Hours')
  })

  it('names them from the schemas in the active language', () => {
    applySchemaNames(SCHEMAS)
    expect(credentialTypeName('IncidentHandlerCertificate')).toBe('Riešiteľ kybernetických incidentov')
    expect(claimLabel('practicalHours')).toBe('Počet hodín praxe')
    setLanguage('en')
    expect(credentialTypeName('IncidentHandlerCertificate')).toBe('Cyber incident handler')
    expect(claimLabel('practicalHours')).toBe('Practical hours')
  })

  it('names attributes only as their schema does', () => {
    expect(claimLabel('holderName')).toBe('holder Name')
    applySchemaNames(SCHEMAS)
    expect(claimLabel('holderName')).toBe('Iný názov')
    expect(credentialTypeName('CybersecurityManagerCertificate')).toBe('Licencia manažéra kybernetickej bezpečnosti')
  })

  it('names the fields every credential has itself', () => {
    applySchemaNames(SCHEMAS)
    expect(claimLabel('id')).toBe('Identifikátor držiteľa')
    expect(claimLabel('expirationDate')).toBe('Platnosť do')
  })

  it('orders claims as their schema lists them, then the common fields', () => {
    applySchemaNames(SCHEMAS)
    expect(
      inClaimOrder([
        ['expirationDate', 1],
        ['unknown', 2],
        ['examDate', 3],
        ['practicalHours', 4],
        ['holderName', 5],
      ]).map(([key]) => key),
    ).toEqual(['practicalHours', 'holderName', 'examDate', 'expirationDate', 'unknown'])
  })

  it('falls back to Slovak when a schema has no English label', () => {
    applySchemaNames(SCHEMAS)
    setLanguage('en')
    expect(claimLabel('examDate')).toBe('Dátum skúšky')
  })

  it('skips malformed entries', () => {
    applySchemaNames(SCHEMAS)
    expect(credentialTypeName('Broken')).toBe('Broken')
    expect(claimLabel('bad')).toBe('bad')
    applySchemaNames('nonsense')
    expect(claimLabel('practicalHours')).toBe('Počet hodín praxe')
  })
})
