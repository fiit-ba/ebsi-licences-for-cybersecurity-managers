import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import moment from 'moment'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import LanguageToggle from '@shared/components/LanguageToggle'
import { describeError } from '@app/localization/i18n/describeError'
import {
  VerificationRequest,
  VerificationResult,
  isVerifierConfigured,
  readOutcome,
  recordVerification,
  requestPresentation,
} from '@infrastructure/verifier/VerifierService'
import { toneColor } from './components/Outcome'
import VerifyI18nKeys from './i18n/keys'
import { useQrSide } from '@shared/hooks/useQrSide'
import { TabAccentContext } from '@shared/components/TabBarIcon'
import { VerifyPhase, VerifyScreenProps, VerifyScreenViewProps } from './screen.types'
import { VERIFY_KEEP_AWAKE_TAG, VERIFY_POLL_MS, VERIFY_TOLERATED_FAILURES } from './screen.constants'

type InternalPhase =
  | { kind: 'starting' }
  | { kind: 'waiting'; request: VerificationRequest }
  | { kind: 'expired' }
  | { kind: 'declined' }
  | { kind: 'done'; result: VerificationResult }
  | { kind: 'error'; message: keyof typeof VerifyI18nKeys; cause?: unknown; request?: VerificationRequest }
type Recorded = 'yes' | 'failed' | null

const useVerifyScreen = ({ navigation, inTab }: VerifyScreenProps): VerifyScreenViewProps => {
  const qrSide = useQrSide(308)
  const { t, i18n } = useTranslation(SCREEN.Verify)
  const record = Boolean(inTab)
  const focused = useIsFocused()
  const tabAccent = useContext(TabAccentContext)
  const [phase, setPhase] = useState<InternalPhase>({ kind: 'starting' })
  const [recorded, setRecorded] = useState<Recorded>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const current = useRef<string | undefined>(undefined)
  const begun = useRef(false)

  useLayoutEffect(() => {
    if (inTab) return
    navigation?.setOptions({
      headerTitle: String(t(VerifyI18nKeys.TITLE)),
      headerRight: () => React.createElement(LanguageToggle, { inHeader: true }),
    })
  }, [navigation, i18n.language, inTab, t])
  const stop = () => {
    clearTimeout(timer.current)
    current.current = undefined
  }
  useEffect(() => {
    if (focused && !begun.current) {
      begun.current = true
      void start()
    }
  }, [focused])
  useEffect(() => stop, [])
  useEffect(() => {
    if (phase.kind !== 'waiting' || !focused) return
    activateKeepAwakeAsync(VERIFY_KEEP_AWAKE_TAG).catch(() => {})
    return () => {
      deactivateKeepAwake(VERIFY_KEEP_AWAKE_TAG).catch(() => {})
    }
  }, [phase.kind, focused])
  const finish = async (request: VerificationRequest, result: VerificationResult) => {
    setPhase({ kind: 'done', result })
    if (!record) return
    try {
      await recordVerification(request.state, result)
      setRecorded('yes')
    } catch (error) {
      console.warn('[wallet] the verification was not recorded:', error)
      setRecorded('failed')
    }
  }
  const poll = (request: VerificationRequest, failures = 0) => {
    timer.current = setTimeout(async () => {
      try {
        const outcome = await readOutcome(request)
        if (current.current !== request.state) return
        if (outcome.status === 'done') {
          current.current = undefined
          await finish(request, outcome)
        } else if (outcome.status === 'expired') {
          current.current = undefined
          setPhase({ kind: 'expired' })
        } else if (outcome.status === 'declined') {
          current.current = undefined
          setPhase({ kind: 'declined' })
        } else poll(request)
      } catch (error) {
        if (current.current !== request.state) return
        if (failures + 1 < VERIFY_TOLERATED_FAILURES) poll(request, failures + 1)
        else {
          current.current = undefined
          setPhase({ kind: 'error', message: VerifyI18nKeys.ERROR_RESULT, cause: error, request })
        }
      }
    }, VERIFY_POLL_MS)
  }
  const watch = (request: VerificationRequest) => {
    current.current = request.state
    setPhase({ kind: 'waiting', request })
    poll(request)
  }
  const start = async () => {
    stop()
    setRecorded(null)
    if (!isVerifierConfigured()) return setPhase({ kind: 'error', message: VerifyI18nKeys.NOT_CONFIGURED })
    setPhase({ kind: 'starting' })
    try {
      watch(await requestPresentation())
    } catch (error) {
      setPhase({ kind: 'error', message: VerifyI18nKeys.ERROR_REQUEST, cause: error })
    }
  }
  const retry = () => {
    if (phase.kind === 'error' && phase.request && moment(phase.request.expiresAt).isAfter(moment()))
      watch(phase.request)
    else void start()
  }
  const viewPhase: VerifyPhase =
    phase.kind === 'waiting'
      ? {
          ...phase,
          expiresAt: t(VerifyI18nKeys.REQUEST_UNTIL, { time: moment(phase.request.expiresAt).format('HH:mm') }),
        }
      : phase.kind === 'error'
        ? {
            kind: 'error',
            message: `${t(phase.message)}${phase.cause !== undefined ? `. ${describeError(phase.cause)}` : ''}`,
          }
        : phase
  const recordNote = !record
    ? t(VerifyI18nKeys.NOT_RECORDED_GUEST)
    : recorded === 'yes'
      ? t(VerifyI18nKeys.RECORDED)
      : recorded === 'failed'
        ? t(VerifyI18nKeys.NOT_RECORDED)
        : ''
  const openOfflineScanner = () => {
    if (!navigation) return
    const navigate = navigation.navigate as (name: 'QrReader', params: {}) => void
    navigate('QrReader', {})
  }
  return {
    phase: viewPhase,
    qrSide,
    // Tabs supply the active profile accent: violet for a TI, blue for a holder.
    // The standalone guest verifier has no tab provider and retains wallet blue.
    primaryColor: tabAccent ?? getThemeColor(ColorKeys.primary),
    warningColor: toneColor('warn'),
    errorColor: toneColor('err'),
    recordNote,
    labels: {
      offlineScan: t(VerifyI18nKeys.OFFLINE_SCAN),
      offlineHint: t(VerifyI18nKeys.OFFLINE_HINT),
      connecting: t(VerifyI18nKeys.CONNECTING),
      intro: t(VerifyI18nKeys.INTRO),
      qr: t(VerifyI18nKeys.QR_LABEL),
      waiting: t(VerifyI18nKeys.WAITING),
      newRequest: t(VerifyI18nKeys.NEW_REQUEST),
      expired: t(VerifyI18nKeys.EXPIRED),
      declined: t(VerifyI18nKeys.DECLINED),
      retry: t(VerifyI18nKeys.RETRY),
      verifyAnother: t(VerifyI18nKeys.VERIFY_ANOTHER),
    },
    start,
    retry,
    openOfflineScanner,
  }
}

export default useVerifyScreen
