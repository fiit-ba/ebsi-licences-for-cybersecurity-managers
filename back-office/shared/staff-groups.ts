/** Versioned administration group and its explicit permission memberships. */
export interface StaffGroup {
  id: number;
  name: string;
  version: number;
  permission_ids: number[];
}

/** Live group-model authority and permission choices available to the acting staff user. */
export interface StaffGroupOptions {
  can_view: boolean;
  can_add: boolean;
  can_change: boolean;
  can_delete: boolean;
  permissions: { id: number; app_label: string; codename: string; name: string }[];
}

/** Bounded administration group list with explicit pagination. */
export interface StaffGroupPage {
  results: StaffGroup[];
  total: number;
  next: number | null;
}
