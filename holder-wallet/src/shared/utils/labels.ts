// Names for what a credential carries, in the holder's language.
// Types and claims are identifiers from the credential itself, in English
// ("CybersecurityManagerLicence", "certificationBody"). A claim is named by
// its schema in the Trusted Schemas Registry (domain/credentials/schemaCatalog.ts),
// in the schema's own words: the wallet keeps no names of its own for a
// certificate's attributes, as the registry gains schemas the wallet was built
// without. Only the fields every credential has are named here. A name missing
// everywhere is shown with its words spaced out.

import moment from 'moment'
import { inLanguage } from '@app/localization/Language'
import { Bilingual, schemaClaimLabel, schemaClaimOrder, schemaTypeName } from '@domain/credentials/schemaCatalog'

type Names = Record<string, { sk: string; en: string }>

const TYPE_NAMES: Names = {
  CybersecurityManagerLicence: {
    sk: 'Licencia manažéra kybernetickej bezpečnosti',
    en: 'Cybersecurity Manager Licence',
  },
  VerifiableAttestation: { sk: 'Overiteľné osvedčenie', en: 'Verifiable attestation' },
  VerifiableCredential: { sk: 'Overiteľný doklad', en: 'Verifiable credential' },
  VerifiablePresentation: { sk: 'Overiteľná prezentácia', en: 'Verifiable presentation' },
  VerifiableAccreditationToAttest: { sk: 'Akreditácia na vydávanie osvedčení', en: 'Accreditation to attest' },
  VerifiableAccreditationToAccredit: { sk: 'Akreditácia na udeľovanie akreditácií', en: 'Accreditation to accredit' },
  VerifiableAuthorisationToOnboard: { sk: 'Oprávnenie na registráciu v EBSI', en: 'Authorisation to onboard in EBSI' },
  VerifiableAuthorisationForTrustChain: { sk: 'Oprávnenie v reťazci dôvery', en: 'Authorisation for the trust chain' },
  StatusList2021Credential: { sk: 'Zoznam stavov dokladov', en: 'Credential status list' },
  BitstringStatusListCredential: { sk: 'Zoznam stavov dokladov', en: 'Credential status list' },
}

// The fields every credential has, shown after the certificate's own attributes.
const CLAIM_LABELS: Names = {
  id: { sk: 'Identifikátor držiteľa', en: 'Holder identifier' },
  validFrom: { sk: 'Platný od', en: 'Valid from' },
  validUntil: { sk: 'Platný do', en: 'Valid until' },
  issuanceDate: { sk: 'Dátum vydania', en: 'Issued on' },
  expirationDate: { sk: 'Platnosť do', en: 'Valid until' },
  issuer: { sk: 'Vydavateľ', en: 'Issuer' },
}

const spaced = (identifier: string): string => identifier.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')

// The wallet's own name for it, or else the schema's (domain/credentials/schemaCatalog.ts).
// Only when no schema names it either does the identifier itself show.
const named = (names: Names, identifier: string, fromSchema?: Bilingual): string => {
  if (names[identifier]) return inLanguage(names[identifier])
  if (fromSchema) return inLanguage({ sk: fromSchema.sk, en: fromSchema.en || undefined })
  return spaced(identifier)
}

export const credentialTypeName = (type: string): string => named(TYPE_NAMES, type, schemaTypeName(type))

/** Types every W3C credential carries, which say nothing of what this one is. */
const GENERIC_TYPES = ['VerifiableCredential', 'VerifiableAttestation']

/** The types that say what a certificate is. */
export const certificateTypes = (types: string[] = []): string[] =>
  types.filter((type) => !GENERIC_TYPES.includes(type))

/** Those types by name, in the holder's language. */
export const certificateTypeNames = (types: string[] = []): string =>
  certificateTypes(types).map(credentialTypeName).join(', ')

export const claimLabel = (key: string): string => named(CLAIM_LABELS, key, schemaClaimLabel(key))

const rank = (key: string): number => {
  const order = [...schemaClaimOrder(), ...Object.keys(CLAIM_LABELS)]
  const index = order.indexOf(key)
  return index === -1 ? order.length : index
}

/** A credential's claims in the order its schema lists them; unknown ones last, as they came. */
export const inClaimOrder = <T>(entries: [string, T][]): [string, T][] =>
  [...entries].sort(([a], [b]) => rank(a) - rank(b))

/** A moment as a date in the holder's language: 13. 10. 2027, or 13/10/2027. */
export const localDate = (value: string | null | undefined): string => {
  if (!value) return ''
  const date = moment(value)
  return date.isValid() ? date.format(inLanguage({ sk: 'D. M. YYYY', en: 'DD/MM/YYYY' })) : ''
}

/** A claim's value as the holder reads it: a date in the local form rather than ISO. */
export const claimValue = (value: unknown): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = moment.utc(value, 'YYYY-MM-DD', true)
    if (date.isValid()) return date.format(inLanguage({ sk: 'D. M. YYYY', en: 'DD/MM/YYYY' }))
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
}
