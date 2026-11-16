export interface OperatorTerms {
  /** Shown under the title, so a holder can tell which version they accepted. */
  version: string
  /** Slovak text, the default. `**bold**` is rendered as bold, as in the i18n bundles. */
  sk: string
  /** English text, for a wallet switched to English; Slovak is shown otherwise. */
  en?: string
}

export const OPERATOR_TERMS: OperatorTerms | null = null
