import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import moment from 'moment'
import qrcode from 'qrcode-generator'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CredentialData } from '@infrastructure/openid/types'
import {
  addActionLog,
  checkPin,
  getCredentialsList,
  getKeychainDataObject,
  setKeychainDataObject,
} from '@infrastructure/persistence/keychain'
import { bindingOfCredentials } from '@infrastructure/identity/binding/binding.service'
import { certificateTypeNames, certificateTypes, claimLabel, inClaimOrder } from '@shared/utils/labels'
import { NoWifiAddress, OpenExchange, openExchange } from '@infrastructure/exchange/server'
import { Query } from '@infrastructure/exchange/session'
import { EXCHANGE_TTL_MS, encodeInvitation } from '@infrastructure/exchange/protocol'
import { signPresentation } from '@infrastructure/exchange/presentation'
import { claimsOf, optionalAttributes, withDisclosed } from '@domain/credentials/sdJwt'
import { ledgerEntryOf } from '@infrastructure/ledger'
import { describeError } from '@app/localization/i18n/describeError'
import PresentI18nKeys from './i18n/keys'
import { useQrSide } from '@shared/hooks/useQrSide'
import { PresentScreenProps } from './screen.types'
import { PRESENT_KEEP_AWAKE_TAG } from './screen.constants'

export type PresentPhase =
  | { kind: 'starting' }
  | { kind: 'waiting'; qr: string; until: number }
  | { kind: 'request'; query: Query }
  | { kind: 'sharing' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string; cause?: unknown }

const qrImage = (text: string): string => {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createDataURL(6, 4)
}

export const vcOf = (credential: CredentialData): any => {
  const jwt = credential.credential as unknown as string
  if (typeof jwt !== 'string' || !jwt.startsWith('ey')) return undefined
  try {
    return claimsOf(jwt).vc
  } catch {
    return undefined
  }
}

const choosableOf = (credential?: CredentialData): string[] => {
  try {
    return credential ? optionalAttributes(credential.credential as unknown as string) : []
  } catch {
    return []
  }
}

const answering = (credentials: CredentialData[], types: string[]): CredentialData[] => {
  const wanted = certificateTypes(types)
  return credentials.filter((credential) => {
    const vc = vcOf(credential)
    if (!vc || credential.status !== 'Active') return false
    if (credential.expirationDate && moment(credential.expirationDate).isBefore(moment())) return false
    const held = ([] as string[]).concat(vc.type ?? [])
    return wanted.every((type) => held.includes(type))
  })
}

const usePresentScreen = ({ navigation }: PresentScreenProps) => {
  const { t, i18n } = useTranslation(SCREEN.Present)
  const [phase, setPhase] = useState<PresentPhase>({ kind: 'starting' })
  const [candidates, setCandidates] = useState<CredentialData[]>([])
  const [chosen, setChosen] = useState(0)
  const [ticked, setTicked] = useState<string[]>([])
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const chooserHeight = Math.max(180, Math.round(useWindowDimensions().height * 0.32))
  const qrSide = useQrSide(308)
  const opened = useRef<OpenExchange | undefined>(undefined)

  useLayoutEffect(
    () => navigation.setOptions({ headerTitle: String(t(PresentI18nKeys.TITLE)) }),
    [navigation, i18n.language, t],
  )
  const close = () => {
    opened.current?.close()
    opened.current = undefined
  }
  const start = useCallback(async () => {
    close()
    setPin('')
    setPinError(false)
    setPhase({ kind: 'starting' })
    try {
      const exchange = await openExchange({
        onRequest: async (query) => {
          setCandidates(answering(await getCredentialsList().catch(() => []), query.types))
          setChosen(0)
          setTicked([])
          setPhase({ kind: 'request', query })
        },
        onFinished: (state) => {
          opened.current = undefined
          setPhase((current) =>
            current.kind === 'done'
              ? current
              : {
                  kind: 'done',
                  message:
                    state === 'answered'
                      ? PresentI18nKeys.SHARED
                      : state === 'declined'
                        ? PresentI18nKeys.DECLINED
                        : current.kind === 'request'
                          ? PresentI18nKeys.TIMED_OUT
                          : PresentI18nKeys.EXPIRED,
                },
          )
        },
      })
      opened.current = exchange
      setPhase({
        kind: 'waiting',
        qr: qrImage(encodeInvitation(exchange.exchange.invitation)),
        until: Date.now() + EXCHANGE_TTL_MS,
      })
    } catch (error) {
      setPhase(
        error instanceof NoWifiAddress
          ? { kind: 'error', message: PresentI18nKeys.NO_WIFI }
          : { kind: 'error', message: PresentI18nKeys.ERROR_OPEN, cause: error },
      )
    }
  }, [])
  useEffect(() => {
    void start()
    return close
  }, [start])
  useEffect(() => {
    if (phase.kind !== 'waiting' && phase.kind !== 'request') return
    activateKeepAwakeAsync(PRESENT_KEEP_AWAKE_TAG).catch(() => {})
    return () => {
      deactivateKeepAwake(PRESENT_KEEP_AWAKE_TAG).catch(() => {})
    }
  }, [phase.kind])

  const certificate = candidates[chosen]
  const vc = useMemo(() => (certificate ? vcOf(certificate) : undefined), [certificate])
  const candidateLabels = useMemo(
    () =>
      candidates.map((candidate) => {
        const subject = vcOf(candidate)?.credentialSubject ?? {}
        return String(subject.certificateNumber ?? subject.certificateTitle ?? candidate.id)
      }),
    [candidates],
  )
  const { id: _binding, ...claims } = (vc?.credentialSubject ?? {}) as Record<string, unknown>
  const choosable = useMemo(() => choosableOf(certificate), [certificate])
  const whole = choosable.length === 0
  const query = phase.kind === 'request' ? phase.query : undefined
  const required = (query?.mandatory ?? []).filter((name) => choosable.includes(name))
  const missing = (query?.mandatory ?? []).filter((name) => !(name in claims))
  const disclosedNames = [...required, ...ticked.filter((name) => choosable.includes(name))]
  const askedFor = (query?.optional ?? []).filter((name) => choosable.includes(name) && !required.includes(name))
  const others = inClaimOrder(choosable.map((name) => [name, claims[name]] as [string, unknown]))
    .map(([name]) => name)
    .filter((name) => !required.includes(name) && !askedFor.includes(name))
  const translated = (key: string): string => String(t(key))
  const validUntil = vc?.validUntil ?? vc?.expirationDate
  const anchorFields = vc
    ? [
        {
          label: translated(PresentI18nKeys.ALWAYS_NUMBER),
          value: String(vc.credentialSubject?.certificateNumber ?? translated(PresentI18nKeys.ALWAYS_MISSING)),
        },
        {
          label: translated(PresentI18nKeys.ALWAYS_ISSUER),
          value: String(
            (typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id) ?? translated(PresentI18nKeys.ALWAYS_MISSING),
          ),
        },
        {
          label: translated(PresentI18nKeys.ALWAYS_TYPE),
          value: certificateTypeNames(([] as string[]).concat(vc.type ?? [])),
        },
        {
          label: translated(PresentI18nKeys.ALWAYS_VALID_UNTIL),
          value: validUntil ? moment(validUntil).format('DD.MM.YYYY') : translated(PresentI18nKeys.ALWAYS_NO_END),
        },
        {
          label: translated(PresentI18nKeys.ALWAYS_SCHEMA),
          value: ([] as unknown[]).concat(vc.credentialSchema ?? []).length
            ? translated(PresentI18nKeys.ALWAYS_PRESENT)
            : translated(PresentI18nKeys.ALWAYS_MISSING),
        },
        {
          label: translated(PresentI18nKeys.ALWAYS_ACCREDITATION),
          value: ([] as unknown[]).concat(vc.termsOfUse ?? []).length
            ? translated(PresentI18nKeys.ALWAYS_PRESENT)
            : translated(PresentI18nKeys.ALWAYS_BY_DID),
        },
        {
          label: translated(PresentI18nKeys.ALWAYS_STATUS),
          value: ledgerEntryOf(vc)
            ? translated(PresentI18nKeys.ALWAYS_PRESENT)
            : translated(PresentI18nKeys.ALWAYS_MISSING),
        },
      ]
    : []
  const decline = () => {
    opened.current?.exchange.decline()
    setPhase({ kind: 'done', message: PresentI18nKeys.DECLINED })
  }
  const share = async (request: Query) => {
    if (!certificate || !opened.current) return
    if (!(await checkPin(pin))) {
      setPinError(true)
      return
    }
    setPhase({ kind: 'sharing' })
    try {
      const { did, privateKey } = await bindingOfCredentials([certificate.credential as unknown as string])
      const presentation = await signPresentation({
        did,
        privateKey,
        credential: withDisclosed(certificate.credential as unknown as string, disclosedNames),
        challenge: request.challenge,
        domain: request.domain,
      })
      opened.current.exchange.answer(presentation)
      const wallet = await getKeychainDataObject()
      if (wallet) {
        addActionLog(
          wallet,
          'Presentation emitted',
          certificate.id,
          request.verifierName ?? request.domain,
          new Date(),
          new Date(),
        )
        await setKeychainDataObject(wallet)
      }
    } catch (error) {
      setPhase({ kind: 'error', message: PresentI18nKeys.ERROR_SHARE, cause: error })
    }
  }

  return {
    t,
    phase,
    candidates,
    chosen,
    setChosen,
    ticked,
    setTicked,
    pin,
    setPin: (value: string) => {
      setPin(value.replace(/[^0-9]/g, ''))
      setPinError(false)
    },
    pinError,
    chooserHeight,
    qrSide,
    certificate,
    vc,
    claims,
    choosable,
    whole,
    query,
    required,
    missing,
    disclosedNames,
    askedFor,
    others,
    candidateLabels,
    anchorFields,
    decline,
    share,
    start,
    goBack: () => navigation.goBack(),
    primaryColor: getThemeColor(ColorKeys.primary),
    errorColor: getThemeColor(ColorKeys.error),
    errorDescription: phase.kind === 'error' && phase.cause !== undefined ? describeError(phase.cause) : '',
  }
}

export default usePresentScreen
