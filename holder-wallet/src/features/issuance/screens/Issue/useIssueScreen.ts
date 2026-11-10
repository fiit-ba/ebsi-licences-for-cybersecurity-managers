import { useEffect, useState } from 'react'
import { Keyboard, Share } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useIsFocused } from '@react-navigation/native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import moment from 'moment'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import {
  Offer,
  OrgSession,
  Scheme,
  Schema,
  SchemeField,
  Texts,
  accreditationState,
  addOrganizationLog,
  certificateScheme,
  currentOrganization,
  isOrganizationError,
  issueCertificate,
  signIn,
} from '@infrastructure/organization/OrganizationService'
import { describeOrganizationError } from '@features/organization/screens/Organization/describe'
import { currentLanguage, inLanguage } from '@app/localization/Language'
import { localDate } from '@shared/utils/labels'
import IssueI18nKeys from './i18n/keys'
import { useQrSide } from '@shared/hooks/useQrSide'
import { ISSUE_KEEP_AWAKE_TAG } from './screen.constants'
import { IssueScreenProps } from './screen.types'

type Problem = { key: keyof typeof IssueI18nKeys | null; cause?: unknown }
export type ChosenScheme = Schema & { organization: string }

const isoDate = (typed: string): string | null => {
  const iso = typed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const local = typed.match(/^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})$/)
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : null
  if (!parts) return null
  const date = moment.utc(parts.map((part) => part.padStart(2, '0')).join('-'), 'YYYY-MM-DD', true)
  return date.isValid() ? date.format('YYYY-MM-DD') : null
}
const initialValues = (scheme: ChosenScheme): Record<string, string> =>
  Object.fromEntries(
    scheme.fields.map((field) => [field.key, field.organization ? scheme.organization : field.default]),
  )
export const ownText = (texts?: Texts): string => (texts ? inLanguage(texts) || texts.sk || '' : '')

const useIssueScreen = (_props: IssueScreenProps) => {
  const qrSide = useQrSide(298)
  const { t } = useTranslation(SCREEN.Issue)
  const organization = currentOrganization()
  const focused = useIsFocused()
  const [signedIn, setSignedIn] = useState(Boolean(OrgSession.token()))
  const [password, setPassword] = useState('')
  const [available, setAvailable] = useState<Scheme | null>(null)
  const [scheme, setScheme] = useState<ChosenScheme | null>(null)
  const [holderReference, setHolderReference] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [flagged, setFlagged] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [endedOn, setEndedOn] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (focused) setSignedIn(Boolean(OrgSession.token()))
  }, [focused])
  useEffect(() => {
    if (!signedIn || !focused) return
    let current = true
    certificateScheme()
      .then((loaded) => {
        if (!current) return
        setAvailable(loaded)
        setEndedOn(undefined)
        const kept = scheme !== null && loaded.schemas.some((item) => item.credential_type === scheme.credential_type)
        if (!kept && loaded.schemas.length > 0) {
          const first = { ...loaded.schemas[0], organization: loaded.organization }
          setScheme(first)
          setValues(initialValues(first))
        }
      })
      .catch((cause) => {
        if (!current) return
        if (isOrganizationError(cause) && cause.key === 'ERROR_SIGNED_OUT') setSignedIn(false)
        setProblem({ key: IssueI18nKeys.ERROR_SCHEME, cause })
      })
    return () => {
      current = false
    }
  }, [signedIn, focused])
  useEffect(() => {
    if (!offer || !focused) return
    activateKeepAwakeAsync(ISSUE_KEEP_AWAKE_TAG).catch(() => {})
    return () => {
      deactivateKeepAwake(ISSUE_KEEP_AWAKE_TAG).catch(() => {})
    }
  }, [offer, focused])

  const accreditation = organization
    ? endedOn !== undefined
      ? accreditationState(endedOn, true)
      : accreditationState(
          available && 'accreditedUntil' in available ? available.accreditedUntil : organization.accreditedUntil,
          available && 'accreditationEnded' in available
            ? available.accreditationEnded
            : organization.accreditationEnded,
        )
    : { kind: 'unknown' as const }
  const ended = accreditation.kind === 'ended'
  const endedDate = ended && accreditation.until ? localDate(accreditation.until) : ''
  const setValue = (key: string) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setFlagged((current) => current.filter((item) => item !== key))
  }
  const signInNow = async () => {
    if (!organization) return
    Keyboard.dismiss()
    setProblem(null)
    setBusy(true)
    try {
      await signIn(organization.username, password)
      setPassword('')
      setAvailable(null)
      setEndedOn(undefined)
      setSignedIn(true)
    } catch (cause) {
      setProblem({ key: null, cause })
    } finally {
      setBusy(false)
    }
  }
  const issueNow = async () => {
    if (!scheme) return
    Keyboard.dismiss()
    setProblem(null)
    const claims: Record<string, string | number> = {}
    const missing: string[] = []
    const invalid: string[] = []
    if (!holderReference.trim()) missing.push('holderReference')
    for (const field of scheme.fields) {
      const value = (values[field.key] ?? '').trim()
      if (!value) {
        if (field.required && !field.default) missing.push(field.key)
        continue
      }
      if (field.kind === 'date') {
        const date = isoDate(value)
        if (date) claims[field.key] = date
        else invalid.push(field.key)
      } else if (field.kind === 'integer') {
        if (/^\d+$/.test(value) && Number(value) > 0) claims[field.key] = Number(value)
        else invalid.push(field.key)
      } else claims[field.key] = value
    }
    if (missing.length || invalid.length) {
      setFlagged([...missing, ...invalid])
      setProblem({ key: missing.length ? IssueI18nKeys.FILL_REQUIRED : IssueI18nKeys.CHECK_FIELDS })
      return
    }
    setBusy(true)
    try {
      const issued = await issueCertificate(holderReference.trim(), claims, scheme.credential_type)
      setOffer(issued)
      setFlagged([])
      addOrganizationLog({
        id: issued.credentialId,
        actionType: 'Certificate issued',
        issuer: '',
        date: new Date(),
        data: { kind: ownText(scheme.name) || scheme.credential_type, type: scheme.credential_type },
      }).catch((error) => console.warn('[wallet] the issuance was not recorded:', error))
    } catch (cause) {
      if (isOrganizationError(cause) && cause.key === 'ERROR_SIGNED_OUT') setSignedIn(false)
      if (isOrganizationError(cause) && cause.key === 'ERROR_ACCREDITATION_EXPIRED') {
        setEndedOn(cause.until)
        return
      }
      if (isOrganizationError(cause)) setFlagged([...cause.missing, ...cause.invalid])
      setProblem({ key: IssueI18nKeys.ERROR, cause })
    } finally {
      setBusy(false)
    }
  }
  const another = () => {
    setOffer(null)
    setProblem(null)
    setHolderReference('')
    if (!scheme) return
    const fresh = initialValues(scheme)
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(
        scheme.fields
          .filter((field) => field.section === 'holder' || field.key === 'certificateNumber')
          .map((field) => [field.key, fresh[field.key]]),
      ),
    }))
  }
  const choose = (schema: Schema) => {
    if (!available || schema.credential_type === scheme?.credential_type) return
    const selected = { ...schema, organization: available.organization }
    setScheme(selected)
    setValues(initialValues(selected))
    setFlagged([])
    setProblem(null)
  }
  const problemText = problem
    ? [problem.key ? t(problem.key) : '', problem.cause !== undefined ? describeOrganizationError(problem.cause) : '']
        .filter(Boolean)
        .join('. ')
    : ''
  const errorColor = getThemeColor(ColorKeys.error)
  const highlight = (key: string) => (flagged.includes(key) ? { error: true, outlineColor: errorColor } : {})
  const label = (field: SchemeField) => {
    const name = ownText(field.label) || String(t(`FIELD_${field.key}`, { defaultValue: field.key }))
    return field.required || field.organization ? name : `${name} ${t(IssueI18nKeys.OPTIONAL)}`
  }
  const hint = (field: SchemeField) =>
    field.kind === 'date' ? '' : ownText(field.hint) || String(t(`HINT_${field.key}`, { defaultValue: '' }))
  const changeHolderReference = (value: string) => {
    setHolderReference(value)
    setFlagged((current) => current.filter((key) => key !== 'holderReference'))
  }
  const shareOffer = () =>
    offer && Share.share({ message: String(t(IssueI18nKeys.SHARE_MESSAGE, { uri: offer.offerUri })) })

  return {
    t,
    qrSide,
    organization,
    signedIn,
    password,
    setPassword,
    available,
    scheme,
    holderReference,
    values,
    busy,
    problemText,
    offer,
    accreditation,
    ended,
    endedDate,
    setValue,
    signInNow,
    issueNow,
    another,
    choose,
    highlight,
    label,
    hint,
    schemaName: (schema: Schema) => ownText(schema.name) || schema.credential_type,
    locale: currentLanguage(),
    changeHolderReference,
    shareOffer,
    orgPrimaryColor: getThemeColor(ColorKeys.orgPrimary),
  }
}

export default useIssueScreen
