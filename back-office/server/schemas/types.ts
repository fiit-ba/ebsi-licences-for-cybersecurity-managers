/** Published certificate attribute definition used by schema validation and issuance. */
export interface SchemaField {
  key: string;
  kind: string;
  section: string;
  label: { sk: string; en: string };
  hint: { sk: string; en: string };
  organization: boolean;
  required: boolean;
  default: string;
}

/** Registered schema version offered to an accredited issuer. */
export interface PublishedSchema {
  credential_type: string;
  name: { sk: string; en: string };
  version: number;
  fields: SchemaField[];
}
