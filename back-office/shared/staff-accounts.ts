/** Administration row preserving original account flags and explicit permission memberships. */
export interface StaffAccount {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  version: number;
  date_joined: string;
  last_login: string | null;
  group_ids: number[];
  permission_ids: number[];
}

/** Current user's available account-administration operations and selectable grants. */
export interface StaffAccountOptions {
  actor_id: number;
  scope: 'all' | 'self';
  can_view: boolean;
  can_add: boolean;
  can_change: boolean;
  can_delete: boolean;
  can_manage_privileges: boolean;
  groups: { id: number; name: string }[];
  permissions: { id: number; name: string; app_label: string; codename: string }[];
}

/** Explicit writable staff-account fields; server-owned timestamps and hashes are excluded. */
export type StaffAccountEdit = Pick<
  StaffAccount,
  | 'username'
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'active'
  | 'is_staff'
  | 'is_superuser'
  | 'group_ids'
  | 'permission_ids'
> & {
  account_id?: number;
  version?: number;
  password?: string;
};
