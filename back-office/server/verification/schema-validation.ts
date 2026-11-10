import { Ajv } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
const addFormats = formats.default;
import { BoundCredentialRefusal } from './credential.ts';
import { VerificationStop } from './outcomes.ts';
import type { trustedSchemaRegistry } from '../schemas/tsr.ts';
import type { CredentialReference } from './types.ts';

/**
 * Create credential validation using schemas loaded only from the trusted TSR.
 *
 * @param registry - Trusted registry document adapter.
 * @returns An async credential/references validator.
 */
export function tsrCredentialValidation(
  registry: Pick<ReturnType<typeof trustedSchemaRegistry>, 'document'>,
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
      const schema = await registry.document(reference.id);
      let validate;
      try {
        const draft = schema.$schema;
        const Validator = draft?.includes('/2020-12/')
          ? Ajv2020
          : draft?.includes('/2019-09/')
            ? Ajv2019
            : Ajv;
        // Compile locally. External references are not fetched or followed.
        const ajv = new Validator({
          strictSchema: true,
          strictTypes: false,
          validateFormats: true,
        });
        addFormats(ajv);
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
 * @returns Completion when the schema accepts the credential.
 * @throws VerificationStop with INDETERMINATE and a specific schema/content explanation.
 * @remarks Domain verification does not enforce format annotations; presentation admission performs its own format checks.
 */
export function validateVerificationSchema(
  credential: unknown,
  schema: Record<string, any>,
  reference: string,
) {
  let validate;
  try {
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
    validate = ajv.compile(schema);
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
