import type { SchemaField } from './types.ts';
import { schemaText as text, schemaFlag, schemaDate, positiveSchemaInteger } from './input.ts';
const reservedTypes = new Set([
  'VerifiableCredential',
  'VerifiableAttestation',
  'VerifiablePresentation',
  'VerifiableAccreditation',
  'VerifiableAccreditationToAttest',
  'VerifiableAccreditationToAccredit',
  'VerifiableAuthorisationToOnboard',
  'VerifiableAuthorisationForTrustChain',
  'StatusList2021Credential',
  'BitstringStatusListCredential',
]);

/** Public HTTP refusal from certificate-schema validation or management. */
export class SchemaError extends Error {
  readonly status: number;
  readonly body: { reason: string; detail: string } & Record<string, unknown>;
  /**
   * Create a schema refusal with optional validation metadata.
   *
   * @param status - HTTP status.
   * @param reason - Stable refusal code.
   * @param detail - Public explanation.
   * @param extra - Additional error fields.
   */
  constructor(status: number, reason: string, detail: string, extra = {}) {
    super(detail);
    this.status = status;
    this.body = { reason, detail, ...extra };
  }
}

/**
 * Validate schema fields while preserving published field kinds.
 *
 * @param credentialType - Credential-type name.
 * @param name - Required display name.
 * @param input - Untrusted field definitions.
 * @param previous - Previously registered versions used to check kind compatibility.
 * @returns Normalized field definitions.
 * @throws SchemaError with indexed validation errors for invalid type, defaults, labels, keys or
 * structure.
 */
export function validateDefinition(
  credentialType: string,
  name: string,
  input: unknown,
  previous: { fields: SchemaField[] }[],
) {
  const errors: { code: string; index: number | null; key: string }[] = [];
  const add = (code: string, index: number | null = null, key = '') =>
    errors.push({ code, index, key });
  if (!/^[A-Z][A-Za-z0-9]{2,99}$/.test(credentialType)) add('TypeInvalid');
  else if (reservedTypes.has(credentialType)) add('TypeReserved');
  if (!name) add('NameMissing');
  if (!Array.isArray(input) || !input.length) add('NoFields');
  if (Array.isArray(input) && input.length > 40) add('TooManyFields');

  const earlierKinds = new Map<string, string>();
  for (const version of previous)
    for (const field of version.fields)
      if (!earlierKinds.has(field.key)) earlierKinds.set(field.key, field.kind);
  const seen = new Set();
  let organizationFields = 0;
  const fields = (Array.isArray(input) ? input.slice(0, 40) : []).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      add('FieldInvalid', index);
      return [];
    }
    const key = text(raw.key || '', 10000);
    const kind = schemaFlag(raw.kind) ? String(raw.kind) : 'text';
    const section = schemaFlag(raw.section) ? String(raw.section) : 'certificate';
    const organization = schemaFlag(raw.organization);
    const label = { sk: text(raw.label?.sk, 120), en: text(raw.label?.en, 120) };
    const hint = { sk: text(raw.hint?.sk, 200), en: text(raw.hint?.en, 200) };
    let fallback = organization ? '' : text(raw.default, 500);
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key)) add('KeyInvalid', index, key);
    else if (key === 'id' || key === 'type') add('KeyReserved', index, key);
    else if (seen.has(key)) add('KeyDuplicate', index, key);
    seen.add(key);
    if (!['text', 'date', 'integer'].includes(kind)) add('KindInvalid', index, key);
    else if (earlierKinds.has(key) && earlierKinds.get(key) !== kind)
      add('KindChanged', index, key);
    if (!['holder', 'training', 'certificate'].includes(section)) add('SectionInvalid', index, key);
    if (!label.sk) add('LabelMissing', index, key);
    if (organization) {
      organizationFields++;
      if (kind !== 'text') add('OrganizationNotText', index, key);
    }
    if (fallback && kind === 'date') {
      const normalized = schemaDate(fallback);
      if (normalized) fallback = normalized;
      else add('DefaultInvalid', index, key);
    }
    if (fallback && kind === 'integer' && !positiveSchemaInteger(fallback))
      add('DefaultInvalid', index, key);
    return [
      {
        key,
        kind,
        section,
        label,
        hint,
        organization,
        required: raw.required === undefined || schemaFlag(raw.required),
        default: fallback,
      },
    ];
  });
  if (organizationFields > 1) add('OrganizationTwice');
  if (errors.length)
    throw new SchemaError(400, 'InvalidSchema', 'The schema definition is not acceptable.', {
      errors,
    });
  return fields;
}
