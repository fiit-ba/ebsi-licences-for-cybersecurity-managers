import { useMemo, useState } from 'react'
import { decodeJwt } from 'jose'
import moment from 'moment'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { filterCredentialType, getTrustedFrameworkFromDid } from '@infrastructure/openid/utils'
import PresentationsI18nKeys from '../../i18n/keys'
import { PresentationDetailProps, PresentationDetailViewProps } from './component.types'

const parsePayload = (value: unknown): any => {
  if (typeof value !== 'string') return value
  try {
    return value.startsWith('ey') ? decodeJwt(value) : JSON.parse(value)
  } catch {
    return undefined
  }
}

const displayVerifier = (verifier?: string): string | undefined => {
  if (!verifier) return undefined
  try {
    return new URL(verifier).host || verifier
  } catch {
    return verifier
  }
}

const usePresentationDetail = (props: PresentationDetailProps): PresentationDetailViewProps => {
  const { t } = useTranslation(SCREEN.Presentations)
  const [expanded, setExpanded] = useState(false)
  const itemKey = String(props.itemTimestamp)
  const selected = props.selectedItems.includes(itemKey)
  const summary = useMemo(() => {
    const payload = parsePayload(props.presentation)
    const vpCredentials = payload?.vp?.verifiableCredential
    const storedCredentials = Array.isArray(vpCredentials) ? vpCredentials : vpCredentials ? [vpCredentials] : [payload]
    const credentialPayloads = storedCredentials.map(parsePayload).filter(Boolean)
    const rawTypes = props.credentialTypes?.length
      ? props.credentialTypes
      : credentialPayloads.flatMap((credential) => {
          const types = credential?.vc?.type ?? credential?.data?.type ?? []
          return Array.isArray(types) ? types : [types]
        })
    const names = Array.from(new Set(filterCredentialType(rawTypes.filter(Boolean))))
    const issuers = credentialPayloads
      .map((credential) => credential?.vc?.issuer ?? credential?.data?.issuer ?? credential?.iss)
      .filter((issuer): issuer is string => typeof issuer === 'string')
    const audience = Array.isArray(payload?.aud) ? payload.aud[0] : payload?.aud
    return {
      title: names.join(', ') || t(PresentationsI18nKeys.UNKNOWN_CREDENTIAL),
      verifier: props.verifier || audience,
      presentationId: payload?.vp?.id || props.id,
      networks: Array.from(new Set(issuers.map(getTrustedFrameworkFromDid))),
      credentialCount: props.credentialCount ?? credentialPayloads.length,
    }
  }, [props.credentialCount, props.credentialTypes, props.id, props.presentation, props.verifier, t])

  const onPress = () => {
    if (props.deleteMode) {
      props.setSelectedItems(
        selected ? props.selectedItems.filter((timestamp) => timestamp !== itemKey) : [...props.selectedItems, itemKey],
      )
    } else setExpanded((current) => !current)
  }

  return {
    deleteMode: props.deleteMode,
    selected,
    expanded,
    legacy: props.legacy,
    title: summary.title,
    presentedAtLabel: t(PresentationsI18nKeys.PRESENTED_AT, {
      date: moment(props.itemTimestamp).format('DD/MM/YYYY HH:mm'),
    }),
    verifierLabel: displayVerifier(summary.verifier),
    presentationId: summary.presentationId,
    verifier: summary.verifier,
    networks: summary.networks,
    credentialCount: summary.credentialCount,
    primaryColor: getThemeColor(ColorKeys.primary),
    mutedColor: getThemeColor(ColorKeys.mutedText),
    labels: {
      verifier: t(PresentationsI18nKeys.VERIFIER),
      legacy: t(PresentationsI18nKeys.LEGACY_RECORD),
      details: t(PresentationsI18nKeys.DETAILS),
      presentationId: t(PresentationsI18nKeys.PRESENTATION_ID),
      network: t(PresentationsI18nKeys.NETWORK),
      sharedCertificates: t(PresentationsI18nKeys.SHARED_CERTIFICATES),
    },
    onPress,
  }
}
export default usePresentationDetail
