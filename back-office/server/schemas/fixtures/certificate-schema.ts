import type { SchemaField } from '../types.ts';

/**
 * A certificate schema document as a test registers it in the development TSR: what
 * `registrySchema` reads back as the same type, title and fields (its Slovak label and hint).
 * @param credentialType - The certificate type.
 * @param title - The schema's title.
 * @param fields - Its attributes.
 * @returns A draft-2020-12 JSON Schema.
 */
export function certificateSchemaDocument(
  credentialType: string,
  title: string,
  fields: SchemaField[],
) {
  const properties: Record<string, unknown> = { id: { type: 'string' } };
  for (const field of fields)
    properties[field.key] = {
      ...(field.kind === 'date'
        ? { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
        : field.kind === 'integer'
          ? { type: 'integer', minimum: 1 }
          : { type: 'string', ...(field.required ? { minLength: 1 } : {}) }),
      title: field.label.sk,
      ...(field.hint.sk ? { description: field.hint.sk } : {}),
      ...(field.default
        ? { default: field.kind === 'integer' ? Number(field.default) : field.default }
        : {}),
    };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'array', items: { type: 'string' }, contains: { const: credentialType } },
      issuer: { type: 'string' },
      credentialSubject: {
        type: 'object',
        properties,
        required: ['id', ...fields.filter((field) => field.required).map((field) => field.key)],
      },
    },
    required: ['type', 'issuer', 'credentialSubject'],
  };
}
