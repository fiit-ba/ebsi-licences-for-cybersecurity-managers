import React, { useLayoutEffect, useState } from 'react'
import { Keyboard } from 'react-native'
import { useTranslation } from 'react-i18next'
import { WalletLock } from '@infrastructure/security/WalletLock'
import { SCREEN } from '@shared/constants/screens'
import LanguageToggle from '@shared/components/LanguageToggle'
import { isBackofficeConfigured } from '@infrastructure/config/Backoffice'
import {
  Organization,
  OrganizationError,
  accreditationState,
  createOrganizationProfile,
  register,
  setPendingOrganization,
  signIn,
} from '@infrastructure/organization/OrganizationService'
import { describeOrganizationError } from './describe'
import { localDate } from '@shared/utils/labels'
import OrganizationI18nKeys from './i18n/keys'
import {
  OrganizationForm,
  OrganizationMode,
  OrganizationScreenProps,
  OrganizationScreenViewProps,
} from './screen.types'

const EMPTY: OrganizationForm = { invitation: '', username: '', password: '', password2: '' }

const useOrganizationScreen = ({ navigation }: OrganizationScreenProps): OrganizationScreenViewProps => {
  const { t, i18n } = useTranslation(SCREEN.Organization)
  const [mode, setModeState] = useState<OrganizationMode>('signIn')
  const [form, setForm] = useState(EMPTY)
  const [account, setAccount] = useState<Organization | null>(null)
  const [pin, setPinState] = useState('')
  const [pin2, setPin2State] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: String(t(OrganizationI18nKeys.TITLE)),
      headerRight: () => React.createElement(LanguageToggle, { inHeader: true }),
    })
  }, [navigation, i18n.language, t])

  const setField = (key: keyof OrganizationForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))
  const refuse = (key: keyof typeof OrganizationI18nKeys) => setError(new OrganizationError(key))
  const submit = async () => {
    Keyboard.dismiss()
    setError(null)
    if (!isBackofficeConfigured()) return refuse(OrganizationI18nKeys.NOT_CONFIGURED)
    const username = form.username.trim()
    if (mode === 'signIn') {
      if (!username || !form.password) return refuse(OrganizationI18nKeys.FILL_ALL)
    } else {
      if (!form.invitation.trim() || !username || !form.password) return refuse(OrganizationI18nKeys.FILL_ALL)
      if (form.password !== form.password2) return refuse(OrganizationI18nKeys.PASSWORDS_DIFFER)
    }
    setBusy(true)
    try {
      if (mode === 'register') await register(form.invitation.trim(), username, form.password)
      const signedIn = await signIn(username, form.password)
      setPendingOrganization(signedIn)
      setAccount(signedIn)
      setForm(EMPTY)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const createProfile = async () => {
    Keyboard.dismiss()
    setError(null)
    if (pin.length < 4) return refuse(OrganizationI18nKeys.PIN_SHORT)
    if (pin !== pin2) return refuse(OrganizationI18nKeys.PINS_DIFFER)
    setBusy(true)
    const unlockedAt = WalletLock.current()
    try {
      await createOrganizationProfile(pin)
      setPinState('')
      setPin2State('')
      // Locked meanwhile: the new profile opens at its sign-in screen instead.
      navigation.reset({ index: 0, routes: [{ name: WalletLock.stillUnlocked(unlockedAt) ? 'Root' : 'Login' }] })
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const state = account
    ? accreditationState(account.accreditedUntil, account.accreditationEnded)
    : { kind: 'unknown' as const }
  const accreditationText =
    state.kind === 'valid' || state.kind === 'ending'
      ? t(OrganizationI18nKeys.ACCREDITED_UNTIL, { date: localDate(state.until) })
      : state.kind === 'ended'
        ? state.until
          ? t(OrganizationI18nKeys.ACCREDITATION_ENDED, { date: localDate(state.until) })
          : t(OrganizationI18nKeys.ACCREDITATION_ENDED_UNDATED)
        : undefined
  const digits = (setter: (value: string) => void) => (value: string) => setter(value.replace(/[^0-9]/g, ''))
  return {
    t,
    mode,
    form,
    account,
    pin,
    pin2,
    busy,
    errorText: error === null ? '' : describeOrganizationError(error),
    accreditationText,
    accreditationEnded: state.kind === 'ended',
    setMode: (value) => {
      setModeState(value)
      setError(null)
    },
    setField,
    setPin: digits(setPinState),
    setPin2: digits(setPin2State),
    submit,
    createProfile,
  }
}

export default useOrganizationScreen
