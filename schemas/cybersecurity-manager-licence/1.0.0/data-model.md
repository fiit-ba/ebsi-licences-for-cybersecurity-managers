# Cybersecurity Manager Licence: data model

This document describes the data model of the `CybersecurityManagerLicence` Verifiable
Credential. It follows the four templates of EBSI's
[Define your Data Model](https://hub.ebsi.eu/docs/services/trust-chains-and-trusted-issuers/data-models/define-data-model):
context, glossary, data model and content classes. The JSON Schema is
[`schema.json`](schema.json), and [`example.json`](example.json) is a complete licence with
fictitious data.

## 1. Context

**What the data model describes.** A licence attesting that a natural person is professionally
competent to act as a cybersecurity manager (*manažér kybernetickej bezpečnosti*) in the Slovak
Republic.

**Who issues it.** Conformity assessment bodies that certify persons. They meet ISO/IEC
17024:2012, the Slovak National Accreditation Service (SNAS) accredits them, and they certify
under the certification scheme of the National Security Authority (NBÚ). On EBSI each body is a
Trusted Issuer (TI) accredited to attest this type. Its accreditation runs from NBÚ, the owner
of the certification scheme, through a Trusted Accreditation Organisation (TAO).

**Who holds it and who relies on it.** The certified cybersecurity manager holds the licence in
a wallet. Relying parties are those that must employ or contract a qualified cybersecurity
manager, such as operators of essential services under Act No. 69/2018 Coll., NBÚ as the
supervisory authority, and employers elsewhere in the EU.

**Normative basis.**

| Source | What it sets |
|---|---|
| Act No. 69/2018 Coll. on Cybersecurity | The role of cybersecurity manager and the duty to prove the manager's competence |
| NBÚ Decree No. 492/2022 Coll., Annex 5 | The knowledge standard of the role: knowledge in five areas with their levels (BL2 to BL6), skills, education and practice, key competences |
| NBÚ certification scheme for verifying the professional competence of a cybersecurity manager, version 1.2 of 12 January 2024, in force from 1 February 2024 | Prerequisites, the professional examination, the certificate, its validity, extension, suspension and termination |
| ISO/IEC 17024:2012 | Requirements on bodies certifying persons, including what a certificate states (clause 9.4) |
| ENISA European Cybersecurity Skills Framework (ECSF) v1, September 2022 | The European role profiles; this role corresponds to *Chief Information Security Officer (CISO)* |

**Relation to the ECSF.** Neither Decree No. 492/2022 Coll. nor the certification scheme
refers to the ECSF. The licence names the ECSF role profile that the Slovak role corresponds
to, so that a relying party in another Member State can read the qualification in European
terms. The ECSF's alternative titles for the profile include *Information Security Manager*.
The correspondence is the following; NBÚ is asked to confirm it.

| Area of Annex 5 of Decree No. 492/2022 Coll. | ECSF CISO profile: e-CF competences (EN 16234-1) with proficiency levels | ECSF CISO profile: key knowledge and tasks |
|---|---|---|
| Security management (*riadenie bezpečnosti*) | D.1 Information Security Strategy Development (5), E.8 Information Security Management (4), E.9 Information Systems Governance (5) | Cybersecurity policies; cybersecurity procedures; management practices; resource management; cybersecurity maturity models |
| Threat and risk management (*riadenie hrozieb a rizík*) | E.3 Risk Management (4) | Risk management standards, methodologies and frameworks |
| Application of security measures (*aplikácia bezpečnostných opatrení*) | E.8 Information Security Management (4) | Cybersecurity recommendations and best practices; cybersecurity standards, methodologies and frameworks |
| Operational security activities (*výkon operatívnych bezpečnostných činností*) | E.8 Information Security Management (4) | Ensure the organisation's resiliency to cyber incidents; supervise the application and improvement of the ISMS |
| Compliance management (*riadenie súladu*) | E.9 Information Systems Governance (5) | Cybersecurity-related laws, regulations and legislations; cybersecurity-related certifications; ethical cybersecurity organisation requirements |
| Research strategies and knowledge management (security management, item 13) | A.7 Technology Trend Monitoring (4) | Monitor advancement in cybersecurity |

**The certification process the licence results from** (certification scheme, sections 3 to 5):

- **Prerequisites.** Full legal capacity; integrity, meaning no final conviction in the last five
  years for an offence under §§ 247 to 247d of the Criminal Code; and education with practice:
  - with complete secondary education, at least 7 years in IT, 5 of them in IT service
    management, information security management, risk management or IT architecture;
  - with a first-cycle university degree, at least 5 years in IT, 3 of them in those fields;
  - with a second- or third-cycle university degree, at least 3 years in IT, 1 of them in those
    fields.

  An international certificate in those fields counts as one year of practice.
- **Professional examination.** A written test, taken in person or remotely: 100
  multiple-choice questions, each with four options of which one is correct, in 150 minutes. The
  questions are drawn at random from at least 400 that NBÚ has approved, covering 16 domains. The
  candidate passes with at least 55 % correct answers.
- **The licence.** Its validity starts on the day of issue, which is the day of the decision to
  grant it, and lasts three years.
- **Extension.** The holder applies at least three months before the end of validity for another
  three-year period. The holder must prove practice as a cybersecurity manager at an operator of
  essential services, at least 60 hours of professional education in information and
  cybersecurity during the validity, and independence.
- **Suspension and termination.** The certification body may suspend a licence on NBÚ's
  initiative for at most 90 days, or at the holder's request for at most one year. It terminates
  the licence when the holder asks, or when the cause of a suspension is not remedied within the
  set period, which is at least 30 days.

**How the process maps to the credential.**

| Event in the scheme | In the credential and the licence registry |
|---|---|
| Decision to grant the licence | A new credential; `issueDate` is the day of the decision, `validFrom` is the start of validity, `expirationDate` is three years later |
| Extension (recertification) | A new credential with a new `id` and `licenceNumber`, whose `previousLicenceNumber` names the licence it extends; the earlier licence expires unchanged |
| Suspension | The licence's record on the licence registry contract becomes `SUSPENDED`; the credential is unchanged |
| Restoration after suspension | The record returns to `VALID` |
| Termination | The record becomes `REVOKED`, which is final |

The credential does not carry the examination's score: under the scheme (4.3.7), the evaluation
of the examination is not disclosed to candidates. The pass mark and the examination's form are
properties of the scheme that `certificationScheme` names, not of each licence.

## 2. Glossary

| Term | Abbreviation | Definition | Reference |
|---|---|---|---|
| Bloom level | BL | One of six levels of educational objectives in Decree No. 492/2022 Coll., Annex 2: BL1 remembering, BL2 understanding, BL3 application, BL4 analysis, BL5 synthesis, BL6 evaluation | Decree No. 492/2022 Coll., Annex 2 |
| Certification scheme | | NBÚ's scheme for verifying the professional competence of a cybersecurity manager | [nbu.gov.sk](https://www.nbu.gov.sk/data/att/2429.pdf) |
| Conformity assessment body | CAB | A body certifying persons under ISO/IEC 17024; on EBSI, the Trusted Issuer | ISO/IEC 17000 |
| e-Competence Framework | e-CF | European standard of ICT competences, EN 16234-1, which the ECSF's role profiles use | EN 16234-1 |
| European Cybersecurity Skills Framework | ECSF | ENISA's framework of twelve cybersecurity role profiles | [ENISA](https://www.enisa.europa.eu/topics/skills-and-competences/skills-development/european-cybersecurity-skills-framework-ecsf), [ecsf-v1.json](https://github.com/enisaeu/ECSF/blob/main/src/framework/ecsf-v1.json) |
| Licence registry contract | | The smart contract on the EBSI ledger that keeps each licence's record and standing | [`licence-status-entry`](../../licence-status-entry/1.0.0/schema.json) |
| National Security Authority | NBÚ | *Národný bezpečnostný úrad*, the Slovak cybersecurity supervisory authority and owner of the certification scheme | Act No. 69/2018 Coll. |
| Selective disclosure | SD-JWT | Each attribute of `credentialSubject` except `id` and `licenceNumber` is signed as the digest of a disclosure, so the holder can present it or withhold it | IETF SD-JWT |
| Slovak National Accreditation Service | SNAS | The national accreditation body, which accredits the certification bodies | Act No. 505/2009 Coll. |
| Trusted Accreditation Organisation, Root TAO, Trusted Issuer | TAO, RTAO, TI | The roles of EBSI's trust chain | [EBSI](https://hub.ebsi.eu/docs/services/trust-chains-and-trusted-issuers) |

## 3. Data model

| Field | Value |
|---|---|
| Name | Cybersecurity Manager Licence |
| Type | `CybersecurityManagerLicence` |
| Version | 1.0.0 |
| Reference | NBÚ Decree No. 492/2022 Coll., Annex 5; NBÚ certification scheme v1.2; ENISA ECSF v1, role profile Chief Information Security Officer (CISO) |
| Expires | — |
| Replaced by | — |
| Owner | *To be filled in: the organisation responsible for the Professional Licence Registry*; domain representative: NBÚ |
| JSON Schema | [`schema.json`](schema.json); id `z3HnfZRoKcq3uWw6rQaJJXu7Qj6amQ7d8FCQbj3vWj4hM` once registered, extends EBSI Verifiable Attestation `zH74MKkYTbQ6ZfTxufi6A3Aw8giS4piGm8dpgxFmkJjmu` |
| Examples | [`example.json`](example.json) |

The credential is a W3C Verifiable Credential (VCDM 1.1) and an EBSI Verifiable Attestation,
issued as a JWT (`jwt_vc_json`) with SD-JWT disclosures.

| Terminology | Description | Type | Other property | Notes |
|---|---|---|---|---|
| `@context` | JSON-LD context | array of URIs | | `https://www.w3.org/2018/credentials/v1` |
| `id` | The licence's identifier | URI | `urn:uuid` | Random; never derived from a personal identification number or from the licence number |
| `type` | Credential types | array of strings | | `VerifiableCredential`, `VerifiableAttestation`, `CybersecurityManagerLicence` |
| `issuer` | The certification body | DID | `did:ebsi` | A TI accredited for this type |
| `issuanceDate` | Start of validity | date-time | | Equal to `validFrom`; the JWT's `nbf` |
| `issued` | When the credential was signed | date-time | | The JWT's `iat` |
| `validFrom` | Start of validity | date-time | | The day of issue under the scheme |
| `expirationDate` | End of validity | date-time | | Three years after issue unless the issuer sets it; the JWT's `exp` |
| `credentialSubject` | The holder and the licence | object | [Content class](#41-credentialsubject) | |
| `credentialSchema` | The schemas the credential follows | array of objects | [Content class](#42-credentialschema) | Exactly three |
| `credentialStatus` | Where the licence's standing is kept | array of objects | [Content class](#43-credentialstatus) | Exactly one `PlrLedgerStatusEntry` |
| `termsOfUse` | The issuer's accreditation | array of objects | [Content class](#44-termsofuse) | `IssuanceCertificate` |
| `evidence` | | | | Not used: the examination's documentation stays with the certification body |

## 4. Content classes

### 4.1 credentialSubject

The cybersecurity manager and the licence granted to them. The attributes follow ISO/IEC
17024's content of a certificate (the certified person's name, a unique identification, the
certification body, the scheme, the scope, and the dates of certification and expiry), the
certification scheme and the ECSF.

| Property | Description | Type | Format | Cardinality | Validation rules |
|---|---|---|---|---|---|
| `id` | The holder's DID, bound to a key the holder's wallet holds for this issuer | string | URI (`did:key`) | 1 | Required |
| `holderName` | Full name with academic titles, as on the licence | string | | 1 | Required; non-empty |
| `licenceNumber` | Number of the licence, unique in the certification body's register | string | | 1 | Required; non-empty; always disclosed |
| `licenceTitle` | Title of the licence as issued | string | | 0..1 | Non-empty; default `Cybersecurity Manager Licence` |
| `role` | The role under Act No. 69/2018 Coll. and Decree No. 492/2022 Coll. | string | | 1 | Required; constant `Cybersecurity Manager` |
| `ecsfRoleProfile` | The ECSF v1 role profile that the role corresponds to (`@ciso` in ENISA's machine-readable framework) | string | | 1 | Required; constant `Chief Information Security Officer (CISO)` |
| `knowledgeStandard` | The knowledge standard the competence was verified against | string | | 1 | Required; non-empty; default `Decree of the National Security Authority No. 492/2022 Coll., Annex 5` |
| `certificationScheme` | The scheme and its version under which the licence was granted | string | | 1 | Required; non-empty; default `NBÚ certification scheme for verifying the professional competence of a cybersecurity manager, version 1.2` |
| `certificationBody` | The conformity assessment body that granted the licence | string | | 1 | Required; non-empty |
| `examDate` | Date of the professional examination | string | date | 0..1 | Not after `issueDate` |
| `issueDate` | Day of the decision to grant the licence; validity starts that day | string | date | 1 | Required |
| `placeOfIssue` | Place of issue | string | | 0..1 | Non-empty |
| `signatory` | Name and position of the person who signed the licence | string | | 0..1 | Non-empty |
| `previousLicenceNumber` | For an extension (recertification), the number of the licence it extends | string | | 0..1 | Non-empty |
| `trainingName` | A training completed before the examination | string | | 0..1 | Non-empty |
| `trainingStart` | First day of the training | string | date | 0..1 | |
| `trainingEnd` | Last day of the training | string | date | 0..1 | Not before `trainingStart`; not after `issueDate` |
| `trainingDays` | Number of training days | integer | | 0..1 | At least 1 |
| `teachingHours` | Number of teaching hours | integer | | 0..1 | At least 1 |
| `funding` | Funding of the training | string | | 0..1 | Non-empty |

Every property except `id` and `licenceNumber` is selectively disclosable. A presentation may
withhold any of them, including required ones. The date rules beyond JSON Schema (`examDate`,
`trainingEnd`) are enforced by the issuer at issuance.

### 4.2 credentialSchema

The schemas in EBSI's Trusted Schemas Registry that the credential follows.

| Property | Description | Type | Format | Cardinality | Validation rules |
|---|---|---|---|---|---|
| `id` | The schema's EBSI URI | string | URI | 1 | `ebsi:<network>:schemas-registry:/schemas/<id>` |
| `type` | The validator | string | | 1 | `FullJsonSchemaValidator2021` |

There are three entries: this schema, the schema of the `PlrLedgerStatusEntry`
(`z42xfynkJ57oPfPEtxWjJ1sb67nWFETyHWBHv8MoNMK3A`), and EBSI's type extension for
`IssuanceCertificate`.

### 4.3 credentialStatus

Where a verifier finds the licence's standing: the licence registry contract on the EBSI ledger.
The verifier computes the record's key from the issuer's DID and the credential's `id`.

| Property | Description | Type | Format | Cardinality | Validation rules |
|---|---|---|---|---|---|
| `id` | The contract as a CAIP-10 account | string | URI | 1 | `eip155:<chainId>:<contract>` |
| `type` | Kind of entry | string | | 1 | `PlrLedgerStatusEntry` |
| `chainId` | The EBSI ledger's chain | integer | | 1 | At least 1 |
| `contract` | The contract's address | string | | 1 | `^0x[0-9a-fA-F]{40}$` |

### 4.4 termsOfUse

| Property | Description | Type | Format | Cardinality | Validation rules |
|---|---|---|---|---|---|
| `id` | The issuer's accreditation attribute in EBSI's Trusted Issuers Registry | string | URI | 1 | `ebsi:<network>:issuers-registry:/issuers/<issuerDid>/attributes/<attributeId>` |
| `type` | Kind of terms | string | | 1 | `IssuanceCertificate` |
