import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import jwt from 'jsonwebtoken'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { getTimeFormat } from '@shared/utils/dates'
import { capitalizeString } from '@shared/utils/string'
import { claimsOf } from '@domain/credentials/sdJwt'
import { filterCredentialType, getTrustedFrameworkFromDid } from '@infrastructure/openid/utils'
import { currentStoredStatus } from '@infrastructure/openid/checkRevocation'
import { markItemStatus } from '@infrastructure/persistence/keychain'
import CredentialsI18nKeys from '../../i18n/keys'
import { CredentialDetailProps, CredentialDetailViewProps } from './component.types'

const useCredentialDetail = (props: CredentialDetailProps): CredentialDetailViewProps => {
  const { t } = useTranslation(SCREEN.Credentials)
  const [expanded, setExpanded] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(props.status)
  const [loading, setLoading] = useState(false)
  const credential = useMemo(() => {
    if (typeof props.credential !== 'string') return props.credential
    if (props.credential.startsWith('ey'))
      return props.credential.includes('~') ? claimsOf(props.credential) : jwt.decode(props.credential)
    try {
      return JSON.parse(props.credential)
    } catch (error) {
      console.error('Error parsing credential as JSON:', error)
      return null
    }
  }, [props.credential])
  const handlePress = useCallback(async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    props.onExpand?.()
    setLoading(true)
    try {
      if (currentStatus !== 'Revoked') {
        const next = await currentStoredStatus(props.credential as string)
        if (next) {
          await markItemStatus(props.timestamp!, 'credential', next)
          setCurrentStatus(next)
        }
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [expanded, currentStatus, props.credential, props.timestamp, props.onExpand])
  useEffect(() => setCurrentStatus(props.status), [props.status])
  const parsed = useMemo(
    () => credential?.vc ?? credential?.payload?.vc ?? credential?.data ?? credential ?? {},
    [credential],
  )
  const expiresAt = parsed.expirationDate ?? parsed.validUntil
  const issuedAt = parsed.issuanceDate ?? parsed.issued
  const normalizedTypes = Array.isArray(parsed.type) ? parsed.type : parsed.type ? [String(parsed.type)] : []
  const displayCredentialType = filterCredentialType(normalizedTypes)
  const subject = parsed.credentialSubject
  const certificateTitle = subject?.certificateTitle
  const displayCertificateTitle =
    (typeof certificateTitle === 'string' || typeof certificateTitle === 'number') && String(certificateTitle).trim()
      ? String(certificateTitle).trim()
      : displayCredentialType.join(', ')
  const reference = useMemo(() => {
    if (!subject || typeof subject !== 'object') return undefined
    for (const name of ['certificateNumber', 'registrationNumber', 'licenceNumber']) {
      const value = subject[name]
      if ((typeof value === 'string' || typeof value === 'number') && String(value)) return String(value)
    }
  }, [subject])
  const formattedIssueDate = issuedAt ? getTimeFormat(issuedAt) : t(CredentialsI18nKeys.NOT_AVAILABLE)
  const formattedExpDate = expiresAt ? getTimeFormat(expiresAt) : t(CredentialsI18nKeys.NEVER)
  const isExpired = Boolean(expiresAt) && new Date(expiresAt).getTime() < Date.now()
  const needsAttention = isExpired || currentStatus === 'Suspended' || currentStatus === 'Revoked'
  const issuerDid = typeof parsed.issuer === 'string' ? parsed.issuer : (parsed.issuer?.id ?? props.issuer)
  let framework = getTrustedFrameworkFromDid(issuerDid)
  if (framework === 'epic') framework = 'Alastria Epic'
  return {
    itemKey: props.key,
    issuer: props.issuer,
    credential,
    expanded,
    loading,
    currentStatus,
    needsAttention,
    displayCertificateTitle,
    reference,
    formattedIssueDate,
    formattedExpDate,
    isExpired,
    displayCredentialType,
    trustedFramework: capitalizeString(framework),
    issuedAt,
    validFrom: parsed.validFrom,
    expiresAt,
    additionalInfo: parsed.credentialSubject,
    primaryColor: getThemeColor(ColorKeys.primary),
    errorColor: getThemeColor(ColorKeys.error),
    labels: {
      reference: t(CredentialsI18nKeys.CREDENTIAL_REFERENCE),
      issuanceDate: t(CredentialsI18nKeys.ISSUANCE_DATE),
      expires: t(CredentialsI18nKeys.EXPIRES),
      state: t(CredentialsI18nKeys.STATE),
      suspended: t(CredentialsI18nKeys.STATE_SUSPENDED),
      revoked: t(CredentialsI18nKeys.STATE_REVOKED),
    },
    handlePress,
  }
}
export default useCredentialDetail
