import type { Pool } from 'pg';
import { transaction } from '../../adapters/transaction.ts';
import { appendAudit } from '../../audit/journal.ts';
import { lockAdministrationActor } from './administration-lock.ts';
import { readStaffAuthority } from './staff-permissions.ts';
import { OperatorManagementError } from './management-error.ts';
import { passwordMatches, hashPassword, maxPasswordBytes } from '../auth/passwords.ts';
import { passwordPolicyCodes } from '../auth/password-policy.ts';

/**
 * Change the acting staff user's password after checking their current credential.
 * @param database - Application PostgreSQL pool.
 * @param actor - Authenticated account ID; no model editing permission is required.
 * @param input - Current password, new password and repeated new password.
 * @param actorVersion - Session generation observed before waiting for locks.
 * @returns Acknowledgement; the caller must sign in with the replacement password.
 * @throws OperatorManagementError for absent staff entry, stale sessions, incorrect
 * current credentials or weak/mismatched input; database/crypto/audit errors.
 */
export async function changeStaffPassword(
  database: Pool,
  actor: number,
  input: Record<string, unknown>,
  actorVersion?: number,
) {
  return transaction(database, async (client) => {
    await lockAdministrationActor(client, actor, actorVersion);
    if (!(await readStaffAuthority(client, actor))?.isStaff)
      throw new OperatorManagementError(403, 'AdministratorRequired', 'Staff access is required.');
    if (
      Object.keys(input).some(
        (key) => !['old_password', 'new_password1', 'new_password2'].includes(key),
      ) ||
      typeof input.old_password !== 'string' ||
      typeof input.new_password1 !== 'string' ||
      input.new_password1 !== input.new_password2 ||
      Buffer.byteLength(input.new_password1) > maxPasswordBytes ||
      Buffer.byteLength(input.old_password) > maxPasswordBytes
    )
      throw new OperatorManagementError(
        400,
        'InvalidFields',
        'Supply the current password and matching new passwords.',
      );
    const account = (await client.query('SELECT * FROM operator_accounts WHERE id=$1', [actor]))
      .rows[0];
    if (!(await passwordMatches(input.old_password, account.password_hash)))
      throw new OperatorManagementError(
        400,
        'IncorrectPassword',
        'Your current password is incorrect.',
      );
    const codes = passwordPolicyCodes(input.new_password1, {
      username: account.username,
      email: account.email,
      firstName: account.first_name,
      lastName: account.last_name,
    });
    if (codes.length) throw new OperatorManagementError(400, 'WeakPassword', codes.join(', '));
    await client.query(
      'UPDATE operator_accounts SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1',
      [actor, await hashPassword(input.new_password1)],
    );
    await client.query('DELETE FROM operator_password_resets WHERE account_id=$1', [actor]);
    await appendAudit(client, {
      event: 'account.password_reset',
      actor,
      detail: { account_id: actor },
    });
    return { status: 'OK' as const };
  });
}
