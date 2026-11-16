import { unverified } from './outcomes.ts';
import { presentationCredentials } from './holder.ts';
import { tsrCredentialValidation } from './schema-validation.ts';
import { underRegistry } from './registry.ts';
import type { verificationRegistry } from './registry.ts';

/**
 * Check the signed credential envelope before accepting a direct-post presentation.
 * @param token - Holder presentation whose signature/binding was established separately.
 * @param registry - Configured TSR reader, never a credential-selected arbitrary origin.
 * @param now - Optional test clock.
 * @returns Whether raw VC context, dates, JWT times and schemas pass presentation admission.
 * @remarks Domain verdicts are evaluated independently. An admission refusal of an otherwise VALID credential becomes INDETERMINATE.
 */
export async function presentationAdmission(
  token: string,
  registry: ReturnType<typeof verificationRegistry>,
  now = new Date(),
) {
  try {
    for (const credential of presentationCredentials(token)) {
      const { payload } = unverified(credential.split('~')[0]);
      const vc = payload.vc;
      const context = vc?.['@context'];
      const v1 = context?.includes('https://www.w3.org/2018/credentials/v1');
      const v2 = context?.includes('https://www.w3.org/ns/credentials/v2');
      if (!v1 && !v2) return false;
      if (!vc.credentialSubject?.id || (vc.validFrom && Date.parse(vc.validFrom) > +now))
        return false;
      if (
        v1 &&
        (!vc.issuanceDate ||
          Date.parse(vc.issuanceDate) > +now ||
          (vc.expirationDate && Date.parse(vc.expirationDate) <= +now))
      )
        return false;
      if (!v1 && v2 && vc.validUntil && Date.parse(vc.validUntil) <= +now) return false;
      if (
        payload.exp !== undefined &&
        (typeof payload.exp !== 'number' || payload.exp * 1000 <= +now - 5000)
      )
        return false;
      if (
        payload.nbf !== undefined &&
        (typeof payload.nbf !== 'number' || payload.nbf * 1000 > +now + 5000)
      )
        return false;
      const schemas = Array.isArray(vc.credentialSchema)
        ? vc.credentialSchema
        : vc.credentialSchema
          ? [vc.credentialSchema]
          : [];
      for (const reference of schemas) {
        if (!underRegistry(reference.id, registry.tsr)) return false;
        // Validate the issuer-signed VC before the disclosure adapter reveals
        // the holder-selected attributes for descriptor resolution.
        await tsrCredentialValidation({ document: (url) => registry.schema(url, true) })(vc, [
          reference,
        ]);
      }
    }
    return true;
  } catch {
    return false;
  }
}
