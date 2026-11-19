/**
 * A certificate attribute, as the issuance form fills it and the credential carries it. It is
 * read from the schema in EBSI's Trusted Schemas Registry: the property's `title` is its label,
 * its `description` the hint, the same in both console languages.
 */
export interface SchemaField {
  key: string;
  kind: string;
  label: { sk: string; en: string };
  hint: { sk: string; en: string };
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
