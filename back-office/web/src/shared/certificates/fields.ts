// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { formatDate, getLang, t } from '../i18n/index.ts';

/** Localized label or hint keyed by the console language. */
type LocalizedText = Record<string, string | undefined>;

/** Schema field identity and optional localized display text. */
interface CertificateField {
  key: string;
  label?: LocalizedText;
  hint?: LocalizedText;
}

/** Schema or schema version containing labels learned by the console. */
interface SchemaLabels {
  versions?: readonly SchemaLabels[] | null;
  fields?: readonly CertificateField[] | null;
}

/**
 * How the console names a certificate's attributes (docs/design decisions D16, D17).
 *
 * Which attributes there are, which are required, their defaults and their
 * labels come from the schema the RootTAO defined (`registry/schemas`,
 * `registry/certificate-scheme`). The words below are for attributes seen
 * without their schema - in a verifier's result, say - and for certificates
 * issued before the schemas. An attribute known to neither shows its
 * identifier with the words spaced out.
 */
const LABELS: Record<string, readonly [string, string]> = {
  certificateTitle: ['Názov osvedčenia', 'napr. Osvedčenie o absolvovaní školenia'],
  holderName: ['Meno a priezvisko s titulmi', 'napr. Ing. Janko Mrkvička, PhD.'],
  jobPosition: ['Pracovné zaradenie', 'napr. manažér kybernetickej bezpečnosti'],
  trainingName: ['Názov školenia', 'napr. Manažér kybernetickej bezpečnosti'],
  trainingStart: ['Školenie od', ''],
  trainingEnd: ['Školenie do', ''],
  trainingDays: ['Počet školiacich dní', 'napr. 5'],
  teachingHours: ['Počet vyučovacích hodín', 'napr. 40'],
  knowledgeStandard: ['Znalostný štandard', 'napr. vyhláška č. 492/2022 Z. z.'],
  certificateNumber: ['Číslo osvedčenia', 'napr. 248'],
  placeOfIssue: ['Miesto vydania', 'napr. Bratislava'],
  issueDate: ['Dátum vydania', ''],
  certificationBody: ['Vydavateľ osvedčenia', ''],
  signatory: ['Podpísal (meno a funkcia)', 'napr. prof. Ing. Ján Novák, PhD., dekan'],
  funding: ['Financovanie', 'napr. Plán obnovy a odolnosti SR, Komponent 17, Reforma č. 5'],
  // Attributes of certificates issued before the scheme (and of other types).
  certificationScheme: ['Certifikačná schéma', ''],
  schemeVersion: ['Verzia schémy', ''],
  registrationNumber: ['Registračné číslo', ''],
};

const ORDER = Object.keys(LABELS);

/**
 * Find an attribute's position in the legacy presentation order.
 * @param key - Attribute identifier.
 * @returns Its known position, or the shared final rank for unknown fields.
 */
const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);

/**
 * Copy attribute entries into certificate display order with unknown fields last.
 * @param entries - Iterable of attribute identifier/value pairs.
 * @returns A sorted copy; input pairs and values are retained unchanged.
 * @throws TypeError if a JavaScript caller supplies a non-iterable input.
 */
export function inFieldOrder<T>(entries: Iterable<readonly [string, T]>) {
  return [...entries].sort(([a], [b]) => rank(a) - rank(b));
}

/** Existing certificate form sections and their Slovak display names. */
export const SECTIONS = {
  holder: 'Držiteľ',
  training: 'Školenie',
  certificate: 'Osvedčenie',
};

/**
 * Choose localized schema text for the active console language, falling back to Slovak.
 * @param texts - Language-keyed text, or an omitted schema value.
 * @returns The selected text or an empty string when neither language has one.
 */
export function inLang(texts?: LocalizedText | null) {
  return (texts && (texts[getLang()] || texts.sk)) || '';
}

// Labels learnt from the schemas, for attributes seen without theirs.
const LEARNT: Record<string, LocalizedText> = {};

/**
 * Learn the first usable label for each attribute across schema versions.
 * @param schemas - Schema/version rows returned by the registry, if available.
 * @returns No return value; labels are retained in this module's existing session cache.
 * @throws TypeError if a JavaScript caller supplies malformed non-iterable schema collections.
 * @remarks Existing cached labels retain precedence, matching the prior console behavior.
 */
export function learnLabels(schemas?: readonly SchemaLabels[] | null) {
  for (const schema of schemas ?? []) {
    for (const version of schema.versions ?? [schema]) {
      for (const field of version.fields ?? []) {
        if (!LEARNT[field.key] && inLang(field.label)) LEARNT[field.key] = field.label;
      }
    }
  }
}

/**
 * Resolve an attribute label from its schema, built-in names, learned labels or identifier.
 * @param key - Attribute identifier used for fallback lookup and word spacing.
 * @param field - Optional field carrying its own localized label.
 * @returns The display label in the active language.
 * @throws TypeError if a JavaScript caller supplies a non-string fallback identifier.
 */
export function fieldLabel(key: string, field?: CertificateField) {
  return (
    inLang(field?.label) ||
    (LABELS[key]?.[0] && t(LABELS[key][0])) ||
    inLang(LEARNT[key]) ||
    key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  );
}

/**
 * Resolve a localized schema hint or its existing built-in fallback.
 * @param key - Attribute identifier used for the built-in lookup.
 * @param field - Optional schema field carrying its own localized hint.
 * @returns The selected hint, or an empty string when none exists.
 */
export function fieldHint(key: string, field?: CertificateField) {
  return inLang(field?.hint) || (LABELS[key]?.[1] && t(LABELS[key][1])) || '';
}

/**
 * Format an attribute value using the console locale for date-only strings.
 * @param value - Attribute value from a certificate or presentation result.
 * @returns Localized date text, JSON for objects or the original string conversion result.
 * Object serialization can return undefined through a custom toJSON hook.
 * @throws JSON serialization or conversion errors, including circular values and custom hooks.
 */
export function fieldValue(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
