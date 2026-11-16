export type Bilingual = { sk: string; en: string }

export type CredentialSchemaNames = {
  credential_type: string
  name: Bilingual
  labels: Record<string, Bilingual>
}

let typeNames: Record<string, Bilingual> = {}
let claimLabels: Record<string, Bilingual> = {}

const usable = (text: Partial<Bilingual> | undefined): text is Bilingual =>
  Boolean(text && typeof text.sk === 'string' && text.sk)

export const applySchemaNames = (schemas: unknown): void => {
  if (!Array.isArray(schemas)) return

  const types: Record<string, Bilingual> = {}
  const labels: Record<string, Bilingual> = {}

  for (const candidate of schemas) {
    if (!candidate || typeof candidate !== 'object') continue
    const schema = candidate as Partial<CredentialSchemaNames>
    if (typeof schema.credential_type !== 'string') continue

    if (usable(schema.name)) {
      types[schema.credential_type] = { sk: schema.name.sk, en: schema.name.en ?? '' }
    }

    for (const [key, label] of Object.entries(schema.labels ?? {})) {
      if (usable(label) && !labels[key]) labels[key] = { sk: label.sk, en: label.en ?? '' }
    }
  }

  typeNames = types
  claimLabels = labels
}

export const schemaTypeName = (type: string): Bilingual | undefined => typeNames[type]

export const schemaClaimLabel = (key: string): Bilingual | undefined => claimLabels[key]
