import moment from 'moment'
import Colors, { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import VerifyI18nKeys from '../i18n/keys'

export type Tone = 'ok' | 'warn' | 'err'

export const OUTCOME_TONES: Record<string, Tone> = {
  VALID: 'ok',
  INVALID: 'err',
  SUSPENDED: 'warn',
  REVOKED: 'err',
  EXPIRED: 'err',
  NOT_YET_VALID: 'warn',
  UNTRUSTED_ISSUER: 'err',
  INVALID_SIGNATURE: 'err',
  STATUS_UNAVAILABLE: 'err',
  INDETERMINATE: 'err',
}

export const VERIFICATION_CONDITIONS = [
  'presentation_valid',
  'signature_valid',
  'issuer_key_valid',
  'disclosures_valid',
  'issuer_accredited',
  'schemas_valid',
  'time_valid',
  'holder_bound',
  'status_available',
  'record_matches',
  'standing_valid',
] as const

export const TONE_ICON: Record<Tone, string> = {
  ok: 'shield-check',
  warn: 'shield-alert',
  err: 'shield-off',
}

export const knownState = (state?: string): string => (state && state in OUTCOME_TONES ? state : 'INDETERMINATE')

export const stateNameKey = (state?: string) => `STATE_${knownState(state)}` as keyof typeof VerifyI18nKeys

export const toneColor = (tone: Tone): string =>
  tone === 'ok' ? getThemeColor(ColorKeys.success) : tone === 'warn' ? Colors.warning : getThemeColor(ColorKeys.error)

export const stateColor = (state?: string): string => toneColor(OUTCOME_TONES[knownState(state)])

export const formatOutcomeDate = (value?: string | null): string =>
  value ? moment(value).format('DD/MM/YYYY HH:mm') : '—'
