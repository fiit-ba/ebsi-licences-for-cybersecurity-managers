// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { formatDate, getLang } from '../i18n/index.ts';

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

// How the console names a certificate's attributes: with the words of its schema in the Trusted
// Schemas Registry (`title` as the label, `description` as the hint), as `registry/schemas` and
// `registry/certificate-scheme` give them, in the schema's own language. The console keeps no
// names of its own for attributes: the registry gains schemas the console was never built with.
// An attribute seen without its schema (in a verifier's result, say) takes the label learnt from
// the schemas; one known to none shows its identifier with the words spaced out.

// Labels learnt from the schemas, in the order the schemas list their attributes.
const LEARNT: Record<string, LocalizedText> = {};
const ORDER: string[] = [];

/**
 * Find an attribute's position in the order its schema lists it.
 * @param key - Attribute identifier.
 * @returns Its learnt position, or the shared final rank for unknown fields.
 */
const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);

/**
 * Copy attribute entries into their schema's order with unknown fields last.
 * @param entries - Iterable of attribute identifier/value pairs.
 * @returns A sorted copy; input pairs and values are retained unchanged.
 * @throws TypeError if a JavaScript caller supplies a non-iterable input.
 */
export function inFieldOrder<T>(entries: Iterable<readonly [string, T]>) {
  return [...entries].sort(([a], [b]) => rank(a) - rank(b));
}

/**
 * Choose localized schema text for the active console language, falling back to Slovak.
 * @param texts - Language-keyed text, or an omitted schema value.
 * @returns The selected text or an empty string when neither language has one.
 */
export function inLang(texts?: LocalizedText | null) {
  return (texts && (texts[getLang()] || texts.sk)) || '';
}

/**
 * Learn the first usable label and the order of each attribute across schema versions.
 * @param schemas - Schema/version rows returned by the registry, if available.
 * @returns No return value; labels are retained in this module's existing session cache.
 * @throws TypeError if a JavaScript caller supplies malformed non-iterable schema collections.
 * @remarks Existing cached labels retain precedence, matching the prior console behavior.
 */
export function learnLabels(schemas?: readonly SchemaLabels[] | null) {
  for (const schema of schemas ?? []) {
    for (const version of schema.versions ?? [schema]) {
      for (const field of version.fields ?? []) {
        if (!ORDER.includes(field.key)) ORDER.push(field.key);
        if (!LEARNT[field.key] && inLang(field.label)) LEARNT[field.key] = field.label;
      }
    }
  }
}

/**
 * Resolve an attribute label from its schema, the labels learnt from the schemas or its identifier.
 * @param key - Attribute identifier used for fallback lookup and word spacing.
 * @param field - Optional field carrying its own localized label.
 * @returns The display label in the active language.
 * @throws TypeError if a JavaScript caller supplies a non-string fallback identifier.
 */
export function fieldLabel(key: string, field?: CertificateField) {
  return inLang(field?.label) || inLang(LEARNT[key]) || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * Resolve an attribute's hint from its schema.
 * @param field - Optional schema field carrying its own hint.
 * @returns The selected hint, or an empty string when none exists.
 */
export function fieldHint(field?: CertificateField) {
  return inLang(field?.hint);
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
