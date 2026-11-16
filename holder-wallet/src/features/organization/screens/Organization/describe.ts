// A sentence for what went wrong in the organization's calls, in the active
// language: the registry's refusals arrive as codes (infrastructure/organization/OrganizationService.ts),
// anything else goes through the wallet's own describer.
import i18next from 'i18next'
import { SCREEN } from '@shared/constants/screens'
import { isOrganizationError } from '@infrastructure/organization/OrganizationService'
import { describeError } from '@app/localization/i18n/describeError'
import { localDate } from '@shared/utils/labels'

const t = (key: string, options: Record<string, unknown> = {}): string =>
  String(i18next.t(key, { ns: SCREEN.Organization, ...options }))

export const describeOrganizationError = (error: unknown): string => {
  if (!isOrganizationError(error)) return describeError(error)
  if (error.key === 'ERROR_WEAK_PASSWORD') {
    const rules = error.codes.map((code) => t(`PASSWORD_${code}`, { defaultValue: '' })).filter(Boolean)
    return [t(error.key), ...rules].join(' ')
  }
  if (error.key === 'ERROR_INVALID_FIELDS') {
    return t(error.key, {
      fields: error.fields.map((field) => t(`FIELD_${field}`, { defaultValue: field })).join(', '),
    })
  }
  // The TI's accreditation ended (design decisions D23), on the date it did.
  if (error.key === 'ERROR_ACCREDITATION_EXPIRED') {
    return error.until ? t(error.key, { date: localDate(error.until) }) : t('ERROR_ACCREDITATION_EXPIRED_UNDATED')
  }
  // Its accreditation was revoked (D24): its own, or its TAO's with it.
  if (error.key === 'ERROR_ACCREDITATION_REVOKED') {
    return t(error.byTao ? 'ERROR_ACCREDITATION_REVOKED_TAO' : error.key, { date: localDate(error.until) })
  }
  return t(error.key)
}
