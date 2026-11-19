import type { DevelopmentSupportOffice } from '../ebsi/support-office.ts';
import { ebsiSchemaCopies, registrySchemaFiles } from './ebsi-schemas.ts';

/** TSR id of the schema of a registry certificate's `credentialStatus` (its record on chain). */
export const ledgerStatusEntrySchemaId = 'zPlrCertificateStatusEntryV4';

/**
 * A registry certificate's status: one entry naming the certificate registry its record is on.
 * A verifier computes the record's key from the issuer and the credential's id, so the entry
 * carries no key (V4); V3 named the governance contract and a key. `/schemas/certificate-status-entry`.
 */
export const ledgerStatusEntrySchema = registrySchemaFiles.certificateStatusEntry;

/**
 * Register schemas in the development Trusted Schemas Registry, as EBSI's Support Office does on
 * EBSI: copies of EBSI's own (the Verifiable Attestation every credential extends, the trust
 * chain's), the platform's certificate status entry, then the given certificate schemas. The back-office never registers a certificate schema itself; it
 * reads the ones it is configured with (`PLR_TSR_SCHEMAS`).
 * @param supportOffice - The development Support Office.
 * @param certificates - Certificate schemas to register, by registry id.
 * @returns Completion once all are registered; an unchanged schema is left as it is.
 * @throws Registry errors.
 */
export async function registerDevelopmentSchemas(
  supportOffice: DevelopmentSupportOffice,
  certificates: { id: string; document: Record<string, unknown> }[] = [],
) {
  for (const copy of ebsiSchemaCopies()) await supportOffice.registerSchema(copy.id, copy.document);
  await supportOffice.registerSchema(ledgerStatusEntrySchemaId, ledgerStatusEntrySchema);
  for (const certificate of certificates)
    await supportOffice.registerSchema(certificate.id, certificate.document);
}
