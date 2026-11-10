// Names for what a credential carries, in the holder's language.
// Types and claims are identifiers from the credential itself, in English
// ("CybersecurityManagerCertificate", "certificationBody"); they were shown to
// the holder as they are. A name missing here is shown with its words spaced
// out, so a new claim is readable before it is translated.

import moment from 'moment'
import { inLanguage } from '@app/localization/Language'
import { Bilingual, schemaClaimLabel, schemaTypeName } from '@domain/credentials/schemaCatalog'

type Names = Record<string, { sk: string; en: string }>

const TYPE_NAMES: Names = {
  CybersecurityManagerCertificate: {
    sk: 'Licencia manažéra kybernetickej bezpečnosti',
    en: 'Cybersecurity Manager License',
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

// In the order a certificate states them, which is the order they are shown in.
const CLAIM_LABELS: Names = {
  // The certificate's scheme (design decisions D16; the back-office's
  // back-office/server/issuance/schemes.ts), in the words of the console.
  certificateTitle: { sk: 'Názov osvedčenia', en: 'Certificate title' },
  holderName: { sk: 'Meno a priezvisko', en: 'Name' },
  jobPosition: { sk: 'Pracovné zaradenie', en: 'Job position' },
  trainingName: { sk: 'Školenie', en: 'Training' },
  trainingStart: { sk: 'Školenie od', en: 'Training from' },
  trainingEnd: { sk: 'Školenie do', en: 'Training until' },
  trainingDays: { sk: 'Počet školiacich dní', en: 'Training days' },
  teachingHours: { sk: 'Počet vyučovacích hodín', en: 'Teaching hours' },
  knowledgeStandard: { sk: 'Znalostný štandard', en: 'Knowledge standard' },
  certificateNumber: { sk: 'Číslo osvedčenia', en: 'Certificate number' },
  placeOfIssue: { sk: 'Miesto vydania', en: 'Place of issue' },
  issueDate: { sk: 'Dátum vydania', en: 'Date of issue' },
  certificationBody: { sk: 'Vydavateľ osvedčenia', en: 'Issued by' },
  signatory: { sk: 'Podpísal', en: 'Signed by' },
  funding: { sk: 'Financovanie', en: 'Funding' },
  id: { sk: 'Identifikátor držiteľa', en: 'Holder identifier' },
  // Claims of certificates issued before the scheme, and of other types.
  registrationNumber: { sk: 'Registračné číslo', en: 'Registration number' },
  certificationScheme: { sk: 'Certifikačná schéma', en: 'Certification scheme' },
  schemeVersion: { sk: 'Verzia schémy', en: 'Scheme version' },
  givenName: { sk: 'Meno', en: 'Given name' },
  familyName: { sk: 'Priezvisko', en: 'Family name' },
  dateOfBirth: { sk: 'Dátum narodenia', en: 'Date of birth' },
  validFrom: { sk: 'Platný od', en: 'Valid from' },
  validUntil: { sk: 'Platný do', en: 'Valid until' },
  issuanceDate: { sk: 'Dátum vydania', en: 'Issued on' },
  expirationDate: { sk: 'Platnosť do', en: 'Valid until' },
  issuer: { sk: 'Vydavateľ', en: 'Issuer' },
}

const spaced = (identifier: string): string => identifier.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')

// A schema's own name for it (domain/credentials/schemaCatalog.ts) when the wallet has
// none: the RootTAO adds schemas the wallet was built without. Only when no
// schema names it either does the identifier itself show.
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

const CLAIM_ORDER = Object.keys(CLAIM_LABELS)
const rank = (key: string): number => {
  const index = CLAIM_ORDER.indexOf(key)
  return index === -1 ? CLAIM_ORDER.length : index
}

/** A credential's claims in the order a certificate states them; unknown ones last, as they came. */
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
