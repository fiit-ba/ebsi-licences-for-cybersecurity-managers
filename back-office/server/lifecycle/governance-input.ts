import { lifecycleRefusal } from './refusal.ts';
import { trimIdentityField } from '../identity/input-text.ts';

/** Serializer field constraints; business/contract policy is checked separately. */
interface Field {
  required?: boolean;
  choices?: readonly string[];
  pattern?: RegExp;
  minimum?: number;
  maximum?: number;
  list?: boolean;
  change?: boolean;
}
const roles = 'ABCDEFGH'.split('');
const actions = ['add_signer', 'remove_signer', 'replace_signer', 'set_policy', 'set_proposal_ttl'];
const votes = ['sign', 'execute', 'cancel', 'expire'];
const identifier = /^[1-9][0-9]{0,77}$/;
const role = /^[A-Za-z0-9_]{1,16}$/;
const needs: Record<string, string[]> = {
  add_signer: ['subject', 'signer_role'],
  remove_signer: ['subject'],
  replace_signer: ['subject', 'replacement'],
  set_policy: ['kind', 'threshold', 'timelock'],
  set_proposal_ttl: ['ttl'],
};

/**
 * Decode serializer fields and aggregate their errors before object-level validation.
 * @param input - Untrusted JSON dictionary.
 * @param fields - Existing field names and constraints; unrelated fields are ignored.
 * @returns Normalized values without introducing policy bounds or contract constraints.
 * @throws IssuanceError with the field-oriented 400 response.
 */
function fieldsInput(input: Record<string, unknown>, fields: Record<string, Field>) {
  const errors: Record<string, unknown> = {},
    values: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const raw = input[name];
    let value: unknown = raw;
    if (raw === undefined) {
      if (field.required) errors[name] = ['This field is required.'];
      continue;
    }
    if (raw === null) {
      errors[name] = ['This field may not be null.'];
      continue;
    }
    if (field.change) {
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors[name] = {
          non_field_errors: [
            `Invalid data. Expected a dictionary, but got ${Array.isArray(raw) ? 'list' : typeof raw === 'string' ? 'str' : typeof raw === 'boolean' ? 'bool' : 'int'}.`,
          ],
        };
        continue;
      }
      try {
        value = governanceChangeInput(raw as Record<string, unknown>);
      } catch (error) {
        if (!(error instanceof Error) || !('body' in error)) throw error;
        errors[name] = error.body;
      }
    } else if (field.list) {
      if (!Array.isArray(raw)) {
        errors[name] = [
          `Expected a list of items but got type "${typeof raw === 'string' ? 'str' : typeof raw === 'boolean' ? 'bool' : typeof raw === 'object' ? 'dict' : 'int'}".`,
        ];
        continue;
      }
      if (raw.length > 8) {
        errors[name] = ['Ensure this field has no more than 8 elements.'];
        continue;
      }
      const itemErrors: Record<string, unknown> = {};
      raw.forEach((item, index) => {
        if (item === null) itemErrors[index] = ['This field may not be null.'];
        else if (!field.choices!.includes(String(item)))
          itemErrors[index] = ['"' + String(item) + '" is not a valid choice.'];
      });
      if (Object.keys(itemErrors).length) errors[name] = itemErrors;
    } else if (field.minimum !== undefined) {
      const text = typeof raw === 'string' ? raw.trim().replace(/\.0*$/, '') : raw;
      value =
        typeof text === 'number' || (typeof text === 'string' && /^[+-]?\d+$/.test(text))
          ? Number(text)
          : NaN;
      if (!Number.isSafeInteger(value)) errors[name] = ['A valid integer is required.'];
      else if (field.maximum !== undefined && Number(value) > field.maximum)
        errors[name] = [`Ensure this value is less than or equal to ${field.maximum}.`];
      else if (Number(value) < field.minimum)
        errors[name] = [`Ensure this value is greater than or equal to ${field.minimum}.`];
    } else if (field.choices) {
      value = String(raw);
      if (!field.choices.includes(String(value)))
        errors[name] = ['"' + String(value) + '" is not a valid choice.'];
    } else {
      if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) {
        errors[name] = ['Not a valid string.'];
        continue;
      }
      value = trimIdentityField(String(raw));
      if (!value) errors[name] = ['This field may not be blank.'];
      else if (!field.pattern!.test(String(value)))
        errors[name] = ['This value does not match the required pattern.'];
    }
    values[name] = value;
  }
  if (Object.keys(errors).length) throw lifecycleRefusal(400, errors);
  return values;
}

/**
 * Restore GovernanceChangeSerializer before current body policy and contract simulation.
 * @param input - Existing administration change request dictionary.
 * @returns Fields, including signer_role; the policy owner derives its canonical change.
 * @throws IssuanceError for field errors or action-specific missing fields.
 */
export function governanceChangeInput(input: Record<string, unknown>) {
  const values = fieldsInput(input, {
    action: { required: true, choices: actions },
    subject: { pattern: /^0x[0-9a-fA-F]{40}$/ },
    replacement: { pattern: /^0x[0-9a-fA-F]{40}$/ },
    signer_role: { choices: roles },
    kind: { choices: ['suspend', 'revoke', 'reinstate', 'admin'] },
    threshold: { minimum: 1, maximum: 8 },
    required_roles: { list: true, choices: roles },
    veto_roles: { list: true, choices: roles },
    timelock: { minimum: 0 },
    ttl: { minimum: 0 },
  });
  const missing = needs[String(values.action)].filter((name) => values[name] === undefined);
  if (missing.length)
    throw lifecycleRefusal(400, {
      non_field_errors: [`${values.action} needs ${missing.join(', ')}.`],
    });
  return values;
}

/**
 * Restore the existing vote, sync, administration and policy-check serializers.
 * @param operation - Existing consumer operation whose serializer is selected.
 * @param input - Untrusted request JSON dictionary.
 * @returns Normalized existing request fields; no contract access or signature is performed.
 * @throws IssuanceError with aggregated serializer errors.
 */
export function governanceInput(
  operation: 'vote' | 'sync' | 'admin' | 'check',
  input: Record<string, unknown>,
) {
  if (operation === 'vote')
    return fieldsInput(input, {
      proposal_id: { required: true, pattern: identifier },
      vote: { required: true, choices: votes },
      role: { required: true, pattern: role },
    });
  if (operation === 'sync')
    return fieldsInput(input, { proposal_id: { required: true, pattern: identifier } });
  const values = fieldsInput(input, {
    ...(operation === 'admin' ? { vote: { required: true, choices: ['propose', ...votes] } } : {}),
    role: { required: operation === 'admin', pattern: role },
    change: { change: true },
    admin_proposal_id: { pattern: identifier },
    // The TI whose rules a new change is for; a pending change names its own.
    ti: { pattern: /^did:ebsi:z[1-9A-HJ-NP-Za-km-z]{1,100}$/ },
  });
  let detail;
  if (operation === 'check') {
    if (!values.change && !values.admin_proposal_id) detail = 'Either change or admin_proposal_id.';
  } else if (values.vote === 'propose') {
    if (!values.change) detail = 'change is required to propose.';
  } else if (!values.admin_proposal_id) detail = `admin_proposal_id is required to ${values.vote}.`;
  if (detail) throw lifecycleRefusal(400, { non_field_errors: [detail] });
  return values;
}
