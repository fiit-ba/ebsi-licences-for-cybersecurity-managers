import { useCallback, useEffect, useMemo, useState } from 'react'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { decodeProtectedHeader } from 'jose'
import { getCredentialsList, markItemStatus } from '@infrastructure/persistence/keychain'
import { currentStoredStatus } from '@infrastructure/openid/checkRevocation'
import { getTimeFormat } from '@shared/utils/dates'
import { CredentialData, DcqlAnswer, DcqlQuery, StoredItemStatus } from '@infrastructure/openid/types'
import { claimsOf, withDisclosed } from '@domain/credentials/sdJwt'
import { answers, assignQueries, claimOptions } from '@domain/credentials/dcql'
import { Disclosable } from './components/DisclosureList'
import requestPresentationModalI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { RequestPresentationModalProps } from './component.types'

const useRequestPresentationModal = (props: RequestPresentationModalProps) => {
  const bundle = 'RequestPresentationModal'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const [showSelectCredentials, setShowSelectCredentials] = useState(false)
  const [credentialsSelected, setCredentialsSelected] = useState<string[]>([])
  const [credentials, setCredentials] = useState<CredentialData[]>([])
  const [plainCredentials, setPlainCredentials] = useState<CredentialData[]>([])
  const [liveStatus, setLiveStatus] = useState<Record<string, StoredItemStatus | null>>({})
  const [checking, setChecking] = useState(true)
  const [showFields, setShowFields] = useState(false)
  // The claim combination chosen for each certificate, by its index in the verifier's
  // claim sets that the certificate satisfies; the verifier's preferred one by default.
  const [chosen, setChosen] = useState<Record<string, number>>({})
  // OpenID4VP 1.0: the verifier asks with a DCQL query.
  const dcqlQuery: DcqlQuery = props.modalProps.dcqlQuery
  const queries = useMemo(() => dcqlQuery?.credentials ?? [], [dcqlQuery])
  const tokenOf = useCallback(
    (id: string) => credentials.find((item) => item.id === id)?.credential as unknown as string,
    [credentials],
  )

  const fetchData = useCallback(async () => {
    const list = await getCredentialsList()
    setCredentials(list)
    setPlainCredentials(
      list.map((credential) => {
        try {
          const token = credential.credential as unknown as string
          return {
            ...credential,
            credential: { header: decodeProtectedHeader(token.split('~')[0]), payload: claimsOf(token) },
          }
        } catch {
          return { ...credential, credential: null }
        }
      }) as any,
    )
  }, [])
  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // The certificates that answer one of the verifier's credential queries.
  const validCredentials = useMemo(
    () =>
      plainCredentials.filter((credential) => {
        const token = tokenOf(credential.id)
        return credential.credential && typeof token === 'string' && queries.some((query) => answers(query, token))
      }),
    [plainCredentials, queries, tokenOf],
  )

  useEffect(() => {
    let cancelled = false
    if (!validCredentials.length) {
      setChecking(false)
      return
    }
    setChecking(true)
    Promise.all(
      validCredentials.map(async (credential) => {
        const token = credentials.find(({ id }) => id === credential.id)?.credential as unknown as string
        if (credential.status === 'Revoked' || typeof token !== 'string')
          return [credential.id, credential.status ?? null] as const
        const next = await currentStoredStatus(token)
        if (next && credential.timestamp) await markItemStatus(credential.timestamp, 'credential', next)
        return [credential.id, next ?? null] as const
      }),
    ).then((entries) => {
      if (!cancelled) {
        setLiveStatus(Object.fromEntries(entries))
        setChecking(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [validCredentials, credentials])

  const availability = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const result: Record<string, { usable: boolean; note?: string }> = {}
    for (const credential of validCredentials) {
      const exp = credential?.credential?.payload?.exp
      const nbf = credential?.credential?.payload?.nbf
      const live = liveStatus[credential.id]
      const status = live !== undefined && live !== null ? live : credential.status
      if (status === 'Revoked')
        result[credential.id] = { usable: false, note: String(t(requestPresentationModalI18nKeys.STATUS_REVOKED)) }
      else if (status === 'Suspended')
        result[credential.id] = { usable: false, note: String(t(requestPresentationModalI18nKeys.STATUS_SUSPENDED)) }
      else if (exp !== undefined && now > exp)
        result[credential.id] = {
          usable: false,
          note: String(
            t(requestPresentationModalI18nKeys.STATUS_EXPIRED, { date: getTimeFormat(credential.expirationDate) }),
          ),
        }
      else if (nbf !== undefined && now < nbf)
        result[credential.id] = {
          usable: false,
          note: String(
            t(requestPresentationModalI18nKeys.STATUS_NOT_YET, { date: getTimeFormat(credential.validFrom) }),
          ),
        }
      else if (live === null)
        result[credential.id] = { usable: true, note: String(t(requestPresentationModalI18nKeys.STATUS_UNVERIFIED)) }
      else result[credential.id] = { usable: true }
    }
    return result
  }, [validCredentials, liveStatus, t])
  const listedCredentials = useMemo(
    () =>
      [...validCredentials].sort((a, b) => Number(!!availability[b.id]?.usable) - Number(!!availability[a.id]?.usable)),
    [validCredentials, availability],
  )
  const usableCount = listedCredentials.filter(({ id }) => availability[id]?.usable).length
  const requiredCount = queries.length
  const single = requiredCount === 1
  // Which certificate answers which credential query.
  const assignment = useMemo(
    () =>
      credentialsSelected.length === requiredCount
        ? assignQueries(
            queries,
            credentialsSelected.map((id) => ({ id, token: tokenOf(id) })),
          )
        : undefined,
    [credentialsSelected, queries, requiredCount, tokenOf],
  )
  const selectionComplete = requiredCount > 0 && Boolean(assignment)
  const disclosable: Disclosable[] = useMemo(
    () =>
      Object.entries(assignment ?? {}).flatMap(([queryId, id]) => {
        const token = tokenOf(id)
        const query = queries.find((item) => item.id === queryId)
        const plain = plainCredentials.find((item) => item.id === id)?.credential as any
        if (!query || typeof token !== 'string' || !plain) return []
        const options = claimOptions(query, token)
        const names = [...new Set(options.flatMap((option) => option.names))]
        // Nothing to choose when every option shares the same attributes.
        if (!names.length || options.every((option) => option.names.length === names.length)) return []
        const subject = plain.payload?.vc?.credentialSubject ?? {}
        return [
          {
            id,
            types: ([] as string[]).concat(plain.payload?.vc?.type ?? []),
            number: subject.certificateNumber,
            attributes: Object.fromEntries(names.map((name) => [name, subject[name]])),
            options: options.map((option) => option.names),
          },
        ]
      }),
    [assignment, queries, plainCredentials, tokenOf],
  )
  const accept = () =>
    props.onAccept?.(
      Object.entries(assignment ?? {}).map(([queryId, id]): DcqlAnswer => {
        const token = tokenOf(id)
        const query = queries.find((item) => item.id === queryId)!
        const options = claimOptions(query, token)
        const option = options[chosen[id] ?? 0] ?? options[0]
        return { queryId, credential: withDisclosed(token, option.names) }
      }),
    )
  const processCredentials = () => {
    if (!showSelectCredentials) setShowSelectCredentials(true)
    else if (selectionComplete && !showFields && disclosable.length) setShowFields(true)
    else if (selectionComplete) accept()
  }
  const choose = (id: string, index: number) => setChosen((current) => ({ ...current, [id]: index }))
  const description = t(
    !showSelectCredentials
      ? requestPresentationModalI18nKeys.DESCRIPTION
      : showFields
        ? requestPresentationModalI18nKeys.FIELDS_DESCRIPTION
        : single
          ? requestPresentationModalI18nKeys.SELECT_ONE
          : requestPresentationModalI18nKeys.SELECT_CREDENTIAL_DESCRIPTION,
  )
  return {
    title: t(requestPresentationModalI18nKeys.TITLE),
    description,
    showSelectCredentials,
    showFields,
    disclosable,
    chosen,
    validCredentials,
    checking,
    usableCount,
    listedCredentials,
    availability,
    requiredCount,
    selectionComplete,
    checkingText: t(requestPresentationModalI18nKeys.CHECKING),
    noneUsableText: t(requestPresentationModalI18nKeys.NONE_USABLE),
    buttonText: t(
      !showSelectCredentials || (!showFields && disclosable.length)
        ? requestPresentationModalI18nKeys.REQUEST_CONTINUE
        : requestPresentationModalI18nKeys.REQUEST,
    ),
    close: () => props.onCancel?.(),
    choose,
    setCredentialsSelected,
    processCredentials,
  }
}

export default useRequestPresentationModal
