import { backendRequest } from './client.ts';
import type {
  StaffGroup,
  StaffGroupOptions,
  StaffGroupPage,
} from '../../../../shared/staff-groups.ts';

/**
 * Read current group-model authority and selectable permission labels.
 * @returns Live group administration options.
 * @throws Authentication, authorization or network refusals.
 */
export async function staffGroupOptions(): Promise<StaffGroupOptions> {
  return backendRequest('/admin/groups/options/');
}

/**
 * List a bounded page of existing groups.
 * @param query - Name search and pagination query from the administration URL.
 * @returns Group rows, total and next offset.
 * @throws Authentication, authorization or network refusals.
 */
export async function staffGroups(query: string): Promise<StaffGroupPage> {
  return backendRequest('/admin/groups/' + query);
}

/**
 * Read a selected group and its current edit version.
 * @param id - Group ID from the administration route.
 * @returns The versioned group with explicit grant IDs.
 * @throws Authentication, authorization, unknown-group or network refusals.
 */
export async function staffGroup(id: number): Promise<StaffGroup> {
  return backendRequest(`/admin/groups/${id}/`);
}

/**
 * Persist the explicit group name and permission memberships.
 * @param fields - Name/grants and existing group ID/version for an update.
 * @returns The committed group.
 * @throws Validation, permission, stale-version, session or network refusals.
 */
export async function saveStaffGroup(fields: {
  name: string;
  permission_ids: number[];
  group_id?: number;
  version?: number;
}): Promise<StaffGroup> {
  return backendRequest('/admin/groups/', { method: 'POST', body: fields });
}

/**
 * Remove the confirmed version of a group and its memberships.
 * @param group - Displayed group and current version.
 * @returns Deleted group ID.
 * @throws Permission, stale-version, session or network refusals.
 */
export async function deleteStaffGroup(group: StaffGroup): Promise<{ id: number }> {
  return backendRequest('/admin/groups/delete/', {
    method: 'POST',
    body: { group_id: group.id, version: group.version },
  });
}
