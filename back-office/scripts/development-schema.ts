import { registrySchemaFiles } from '../server/schemas/ebsi-schemas.ts';

/**
 * The development installation's certificate schema, as the development Support Office registers
 * it in the Trusted Schemas Registry: the same document as is registered on EBSI's pilot
 * (`/schemas/cybersecurity-manager-licence`), extending EBSI's Verifiable Attestation. The
 * back-office reads it from there (`PLR_TSR_SCHEMAS`), like any schema on EBSI.
 */
export const developmentSchemaId = 'zPlrCybersecurityManagerV3';

/** The certificate type the schema is for. */
export const developmentCredentialType = 'CybersecurityManagerLicence';

/** The JSON Schema registered under {@link developmentSchemaId}. */
export const developmentSchemaDocument = registrySchemaFiles.cybersecurityManagerLicence;
