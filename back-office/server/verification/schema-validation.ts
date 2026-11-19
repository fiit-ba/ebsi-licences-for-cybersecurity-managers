import { Ajv } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
const addFormats = formats.default;
import { BoundCredentialRefusal } from './credential.ts';
import { VerificationStop } from './outcomes.ts';
import type { trustedSchemaRegistry } from '../schemas/tsr.ts';
import type { CredentialReference } from './types.ts';
import { registrySchemaId } from '../schemas/ebsi-schemas.ts';

/**
 * The schemas a schema refers to in a Trusted Schemas Registry (EBSI's Verifiable Attestation,
 * which every credential schema extends), read from the same registry as the referring schema:
 * a `$ref` names a schema by its id, so the pilot's id resolves in the development registry too.
 * Anything else a schema refers to is not fetched.
 * @param schema - The referring schema.
 * @param address - Its address in the configured registry.
 * @param load - Reads a schema from the configured registry.
 * @param presented - Whether to apply {@link presentedSchema} to each.
 * @returns The schemas referred to, by the exact `$ref` that names them.
 * @throws Error for a reference outside a registry, or more than ten schemas; loading errors.
 */
export async function referencedSchemas(
  schema: Record<string, any>,
  address: string,
  load: (url: string) => Promise<Record<string, any>>,
  presented = false,
) {
  const base = address.slice(0, address.lastIndexOf('/schemas/') + '/schemas/'.length);
  const found = new Map<string, Record<string, any>>();
  const pending = [schema];
  while (pending.length) {
    const references = new Set<string>();
    /**
     * Gather the references to other documents a schema value makes.
     * @param value - Part of the schema.
     * @returns Nothing; the references go into `references`.
     */
    function collect(value: unknown) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object')
        for (const [key, item] of Object.entries(value))
          if (key === '$ref' && typeof item === 'string' && !item.startsWith('#'))
            references.add(item);
          else collect(item);
    }
    collect(pending.pop());
    for (const reference of references) {
      if (found.has(reference)) continue;
      const id = registrySchemaId(reference);
      if (!id) throw new Error(`The schema refers to ${reference}, outside a schemas registry.`);
      if (found.size >= 10) throw new Error('The schema refers to too many schemas.');
      const document = await load(base + id);
      found.set(reference, presented ? presentedSchema(document) : document);
      pending.push(document);
    }
  }
  return found;
}

/**
 * The schema a presented credential must meet. A holder may withhold any attribute it was given
 * selectively, so a presentation cannot tell a withheld attribute from a missing one: the
 * schema's `credentialSubject.required` says what the issuer must put in (issuance checks it),
 * and a verifier asks for what it needs with its DCQL query. Only the subject's `id` stays required.
 * @param schema - JSON Schema from the TSR.
 * @returns A copy without the subject's other required attributes, in the document and its
 * `allOf` parts.
 */
export function presentedSchema(schema: Record<string, any>) {
  const copy = structuredClone(schema);
  for (const part of [copy, ...(Array.isArray(copy.allOf) ? copy.allOf : [])]) {
    const subject = part?.properties?.credentialSubject;
    if (subject && typeof subject === 'object' && Array.isArray(subject.required))
      subject.required = subject.required.filter((key: unknown) => key === 'id');
  }
  return copy;
}

/**
 * Create credential validation using schemas loaded only from the trusted TSR.
 *
 * @param registry - Trusted registry document adapter.
 * @param options - `presented`: the credential is a presentation's, whose holder may have
 * withheld attributes ({@link presentedSchema}); otherwise the issuer's whole credential.
 * @returns An async credential/references validator.
 */
export function tsrCredentialValidation(
  registry: Pick<ReturnType<typeof trustedSchemaRegistry>, 'document'>,
  options: { presented?: boolean } = {},
) {
  /**
   * Validate a disclosed credential against each referenced supported JSON Schema.
   *
   * @param credential - Credential object reconstructed with disclosed subject claims.
   * @param references - Trusted schema reference objects.
   * @returns Completion when every schema accepts the credential.
   * @throws BoundCredentialRefusal for schema mismatch; Error for compilation failure;
   * registry-loading errors.
   * @remarks External schema references are not fetched.
   */
  async function validateSchemas(
    credential: unknown,
    references: Pick<CredentialReference, 'id'>[],
  ) {
    for (const reference of references) {
      const loaded = await registry.document(reference.id);
      const schema = options.presented ? presentedSchema(loaded) : loaded;
      let validate;
      let referenced;
      try {
        referenced = await referencedSchemas(
          loaded,
          reference.id,
          (url) => registry.document(url),
          options.presented,
        );
      } catch {
        throw new Error('The TSR schema could not be compiled.');
      }
      try {
        const draft = schema.$schema;
        const Validator = draft?.includes('/2020-12/')
          ? Ajv2020
          : draft?.includes('/2019-09/')
            ? Ajv2019
            : Ajv;
        // Compile locally, with only the registry schemas it refers to.
        const ajv = new Validator({
          strictSchema: true,
          strictTypes: false,
          validateFormats: true,
        });
        addFormats(ajv);
        for (const [key, document] of referenced) ajv.addSchema(document, key);
        validate = ajv.compile(schema);
      } catch {
        throw new Error('The TSR schema could not be compiled.');
      }
      if (!validate(credential))
        throw new BoundCredentialRefusal('SchemaMismatch', 'INDETERMINATE');
    }
  }
  return validateSchemas;
}

/**
 * Validate a verifier document with distinct schema-definition and content refusals.
 * @param credential - Signature-verified credential after disclosure reconstruction.
 * @param schema - JSON Schema loaded from the configured TSR.
 * @param reference - Public schema URL used in failure evidence.
 * @param load - Reads a schema it refers to from the configured TSR ({@link referencedSchemas}).
 * @returns Completion when the schema accepts the credential.
 * @throws VerificationStop with INDETERMINATE and a specific schema/content explanation.
 * @remarks Domain verification does not enforce format annotations; presentation admission performs its own format checks.
 * The credential is a presentation's, so the subject's attributes are not required ({@link presentedSchema}).
 */
export async function validateVerificationSchema(
  credential: unknown,
  schema: Record<string, any>,
  reference: string,
  load: (url: string) => Promise<Record<string, any>> = async () => {
    throw new Error('No schema loader.');
  },
) {
  let validate;
  try {
    const referenced = await referencedSchemas(schema, reference, load, true);
    const draft = schema.$schema;
    const Validator = draft?.includes('/2020-12/')
      ? Ajv2020
      : draft?.includes('/2019-09/')
        ? Ajv2019
        : Ajv;
    const ajv = new Validator({
      strictSchema: false,
      strictTypes: false,
      validateFormats: false,
      allErrors: true,
    });
    for (const [key, document] of referenced) ajv.addSchema(document, key);
    validate = ajv.compile(presentedSchema(schema));
  } catch {
    throw new VerificationStop(
      'INDETERMINATE',
      `Schema ${reference} is itself invalid`,
      'schemas_valid',
    );
  }
  if (!validate(credential)) {
    const first = [...(validate.errors ?? [])].sort((left, right) =>
      left.instancePath.localeCompare(right.instancePath, 'en'),
    )[0];
    const path = first?.instancePath?.slice(1) || '(root)';
    throw new VerificationStop(
      'INDETERMINATE',
      `Does not match ${reference} at ${path}: ${first?.message ?? 'schema validation failed'}`,
      'schemas_valid',
    );
  }
}
