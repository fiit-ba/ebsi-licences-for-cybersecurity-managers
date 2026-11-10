import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { BRAND } from '@shared/constants/brand'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { claimLabel } from '@shared/utils/labels'
import { certificates, ebsi } from '@infrastructure/config/Ebsi'
import { recordVerification } from '@infrastructure/verifier/VerifierService'
import { CERTIFICATE_TYPE, DEFAULT_FIELDS, parseInvitation } from '@infrastructure/exchange/protocol'
import { ExchangeDeclined, ExchangeExpired, askForPresentation } from '@infrastructure/exchange/client'
import { verifyPresentation } from '@infrastructure/exchange/verify'
import LocalStorageService, { STORAGE_KEYS } from '@infrastructure/storage'
import { toneColor } from '@features/verification/screens/Verify/components/Outcome'
import VerifyI18nKeys from '@features/verification/screens/Verify/i18n/keys'
import { VerifyOfflinePhase, VerifyOfflineScreenProps, VerifyOfflineScreenViewProps } from './screen.types'

type InternalPhase =
  Exclude<VerifyOfflinePhase, { kind: 'error' }> | { kind: 'error'; message: keyof typeof VerifyI18nKeys }

const useVerifyOfflineScreen = ({ route, navigation }: VerifyOfflineScreenProps): VerifyOfflineScreenViewProps => {
  const { t, i18n } = useTranslation(SCREEN.Verify)
  const [phase, setPhase] = useState<InternalPhase>({ kind: 'asking' })
  const cancelled = useRef(false)

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: String(t(VerifyI18nKeys.OFFLINE_TITLE)) })
  }, [navigation, i18n.language, t])

  useEffect(() => {
    cancelled.current = false
    ;(async () => {
      const invitation = parseInvitation(String(route.params?.invitation ?? ''))
      if (!invitation) return setPhase({ kind: 'error', message: VerifyI18nKeys.OFFLINE_INVALID_QR })
      if (!ebsi.isConfigured() || !certificates.registry()) {
        return setPhase({ kind: 'error', message: VerifyI18nKeys.OFFLINE_NOT_CONFIGURED })
      }
      try {
        const asked = await askForPresentation(invitation, [CERTIFICATE_TYPE], DEFAULT_FIELDS, {
          verifierName: String(t(VerifyI18nKeys.OFFLINE_VERIFIER_NAME, { brand: BRAND.NAME })),
          isCancelled: () => cancelled.current,
        })
        if (cancelled.current) return
        setPhase({ kind: 'checking' })
        const result = await verifyPresentation(asked.presentation, asked)
        if (cancelled.current) return
        setPhase({ kind: 'done', result })
        if (await LocalStorageService.getBool(STORAGE_KEYS.IS_WALLET_CREATED).catch(() => false)) {
          await recordVerification(`exchange:${Date.now()}`, result).catch(() => {})
        }
      } catch (error) {
        if (cancelled.current) return
        setPhase({
          kind: 'error',
          message:
            error instanceof ExchangeDeclined
              ? VerifyI18nKeys.OFFLINE_DECLINED
              : error instanceof ExchangeExpired
                ? VerifyI18nKeys.OFFLINE_EXPIRED
                : VerifyI18nKeys.OFFLINE_FAILED,
        })
      }
    })()
    return () => {
      cancelled.current = true
    }
  }, [route.params?.invitation, t])

  const viewPhase: VerifyOfflinePhase = phase.kind === 'error' ? { kind: 'error', message: t(phase.message) } : phase
  const missingFields = phase.kind === 'done' ? phase.result.missingFields.map(claimLabel).join(', ') : ''

  return {
    phase: viewPhase,
    primaryColor: getThemeColor(ColorKeys.primary),
    warningColor: toneColor('warn'),
    errorColor: toneColor('err'),
    waitingText: t(VerifyI18nKeys.OFFLINE_WAITING),
    checkingText: t(VerifyI18nKeys.OFFLINE_CHECKING),
    missingFieldsText: t(VerifyI18nKeys.OFFLINE_MISSING_FIELDS, { fields: missingFields }),
    scanAgainText: t(VerifyI18nKeys.OFFLINE_SCAN_AGAIN),
    scanAgain: () => navigation.replace('QrReader', {}),
  }
}

export default useVerifyOfflineScreen
