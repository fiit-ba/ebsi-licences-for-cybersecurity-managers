import { backendRequest } from './client.ts';
import type {
  StaffAccount,
  StaffAccountEdit,
  StaffAccountOptions,
} from '../../../../shared/staff-accounts.ts';
import type { OperatorPage } from '../../../../shared/operator-accounts.ts';

/**
 * Load live account administration authority and authorized grant choices.
 * @returns The current staff scope and model permissions.
 * @throws Existing authentication, permission or network refusal.
 */
export async function staffAccountOptions(): Promise<StaffAccountOptions> {
  return backendRequest('/admin/accounts/options/');
}

/**
 * Read the bounded account list within the current user's administration scope.
 * @param search - Username/email search text.
 * @param offset - Nonnegative pagination offset.
 * @returns Visible account rows, total and the next page offset.
 * @throws Existing authentication, permission or network refusal.
 */
export async function staffAccountList(search: string, offset: number): Promise<OperatorPage> {
  const query = new URLSearchParams({ q: search, offset: String(offset) });
  return backendRequest('/admin/accounts/?' + query);
}

/**
 * Read one permitted account with its current edit version and explicit memberships.
 * @param id - Account ID from the administration route.
 * @returns Public account fields, without credential hashes.
 * @throws Existing authentication, scope, unknown-account or network refusal.
 */
export async function staffAccount(id: number): Promise<StaffAccount> {
  return backendRequest(`/admin/accounts/${id}/`);
}

/**
 * Save explicit account fields using optimistic concurrency and live server authorization.
 * @param fields - Create fields or a versioned update; password is omitted unless explicitly entered.
 * @returns The committed account projection.
 * @throws Existing validation, privilege, stale-version, session or network refusal.
 */
export async function saveStaffAccount(fields: StaffAccountEdit): Promise<StaffAccount> {
  return backendRequest('/admin/accounts/', { method: 'POST', body: fields });
}

/**
 * Delete an unchanged account with live model permission and history checks.
 * @param account - Current versioned account displayed for confirmation.
 * @returns Deleted account ID.
 * @throws Existing permission, protected-history, version, session or network refusal.
 */
export async function deleteStaffAccount(account: StaffAccount): Promise<{ account_id: number }> {
  return backendRequest('/admin/accounts/delete/', {
    method: 'POST',
    body: { account_id: account.id, version: account.version },
  });
}
