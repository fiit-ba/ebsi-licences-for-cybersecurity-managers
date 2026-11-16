import { lifecycleRefusal } from '../lifecycle/refusal.ts';
import { trimIdentityField } from '../identity/input-text.ts';

/**
 * Validate reason disclosure fields before any private lookup.
 * @param input - Existing optional local UUID and on-chain proposal number fields.
 * @returns Normalized identifiers; extension fields remain with their owning operation.
 * @throws IssuanceError with aggregated field or missing-identifier errors.
 */
export function auditReasonInput(input: Record<string, unknown>) {
  const errors: Record<string, unknown> = {};
  let local: string | undefined;
  let onchain: string | undefined;
  if (input.proposal_id !== undefined) {
    if (input.proposal_id === null) errors.proposal_id = ['This field may not be null.'];
    else {
      const value = input.proposal_id;
      const hex =
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          ? value.toString(16).padStart(32, '0')
          : typeof value === 'string'
            ? value.replace(/urn:uuid:|[{}-]/g, '')
            : '';
      if (!/^[0-9a-f]{32}$/i.test(hex)) errors.proposal_id = ['Must be a valid UUID.'];
      else local = hex.toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    }
  }
  if (input.onchain_proposal_id !== undefined) {
    const raw = input.onchain_proposal_id;
    if (raw === null) errors.onchain_proposal_id = ['This field may not be null.'];
    else if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw)))
      errors.onchain_proposal_id = ['Not a valid string.'];
    else {
      const text = trimIdentityField(String(raw));
      if (!text) errors.onchain_proposal_id = ['This field may not be blank.'];
      else if (!/^[1-9][0-9]{0,77}$/.test(text))
        errors.onchain_proposal_id = ['This value does not match the required pattern.'];
      else onchain = text;
    }
  }
  if (Object.keys(errors).length) throw lifecycleRefusal(400, errors);
  if (!local && !onchain)
    throw lifecycleRefusal(400, {
      non_field_errors: ['Either proposal_id or onchain_proposal_id.'],
    });
  return { local, onchain };
}
