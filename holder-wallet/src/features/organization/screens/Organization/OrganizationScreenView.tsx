// The organization's profile, created (design decisions D15, D18): a TI signs in
// with its back-office account - or registers it with the invitation the TAO
// that selected it gave it, since nobody registers unasked - and then chooses
// the profile's own PIN. That is all: the organization's profile holds no keys
// and no certificates, so it needs no security phrase, and it is independent
// of the certificate holder's wallet. Each has its own PIN; deleting one
// leaves the other. Reached from the registration and sign-in screens and from
// the header menu of the holder's wallet; either way the app then opens the
// organization's profile, in its violet, with the Issue tab.
import { StatusBar, Text, View } from 'react-native'
import { SegmentedButtons } from 'react-native-paper'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { OrgButton, OrgField } from '@features/organization/components/Organization'
import OrganizationI18nKeys from '@features/organization/screens/Organization/i18n/keys'
import SafeScrollView from '@shared/components/SafeScrollView'
import { OrganizationScreenViewProps } from './screen.types'
import { screenStyles as styles } from './screen.styles'

const OrganizationScreenView = ({
  t,
  mode,
  form,
  account,
  pin,
  pin2,
  busy,
  errorText,
  accreditationText,
  accreditationEnded,
  setMode,
  setField,
  setPin,
  setPin2,
  submit,
  createProfile,
}: OrganizationScreenViewProps) => {
  if (account) {
    return (
      <SafeScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StatusBar backgroundColor="transparent" barStyle="light-content" />
        <View style={styles.card}>
          <Text style={styles.organization}>{account.organization}</Text>
          {accreditationText && (
            <Text style={accreditationEnded ? styles.error : styles.hint}>{accreditationText}</Text>
          )}
          <Text style={styles.cardTitle}>{t(OrganizationI18nKeys.PIN_TITLE)}</Text>
          <Text style={styles.intro}>{t(OrganizationI18nKeys.PIN_TEXT, { username: account.username })}</Text>
        </View>
        <OrgField
          label={String(t(OrganizationI18nKeys.PIN))}
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secure
        />
        <OrgField
          label={String(t(OrganizationI18nKeys.PIN_AGAIN))}
          value={pin2}
          onChangeText={setPin2}
          keyboardType="number-pad"
          secure
        />
        {errorText !== '' && <Text style={styles.error}>{errorText}</Text>}
        <OrgButton onPress={createProfile} loading={busy} disabled={busy || !pin || !pin2} style={styles.submit}>
          {t(OrganizationI18nKeys.CREATE_PROFILE)}
        </OrgButton>
        <Text style={styles.hint}>{t(OrganizationI18nKeys.PIN_HINT)}</Text>
      </SafeScrollView>
    )
  }

  return (
    <SafeScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <StatusBar backgroundColor="transparent" barStyle="light-content" />
      <Text style={styles.intro}>{t(OrganizationI18nKeys.INTRO)}</Text>
      <SegmentedButtons
        value={mode}
        onValueChange={(value) => setMode(value as 'signIn' | 'register')}
        buttons={[
          { value: 'signIn', label: String(t(OrganizationI18nKeys.TAB_SIGN_IN)) },
          { value: 'register', label: String(t(OrganizationI18nKeys.TAB_REGISTER)) },
        ]}
        theme={{
          colors: {
            secondaryContainer: getThemeColor(ColorKeys.orgSurface),
            onSecondaryContainer: getThemeColor(ColorKeys.orgPrimary),
            onSurface: getThemeColor(ColorKeys.text),
            outline: getThemeColor(ColorKeys.border),
          },
        }}
        style={styles.segments}
      />

      {mode === 'register' && (
        <OrgField
          label={String(t(OrganizationI18nKeys.INVITATION))}
          value={form.invitation}
          onChangeText={setField('invitation')}
          autoCapitalize="characters"
          placeholder="XXXX-XXXX-XXXX"
        />
      )}
      <OrgField
        label={String(t(OrganizationI18nKeys.USERNAME))}
        value={form.username}
        onChangeText={setField('username')}
      />
      <OrgField
        label={String(t(OrganizationI18nKeys.PASSWORD))}
        value={form.password}
        onChangeText={setField('password')}
        secure
      />
      {mode === 'register' && (
        <OrgField
          label={String(t(OrganizationI18nKeys.PASSWORD_AGAIN))}
          value={form.password2}
          onChangeText={setField('password2')}
          secure
        />
      )}

      {errorText !== '' && <Text style={styles.error}>{errorText}</Text>}

      <OrgButton onPress={submit} loading={busy} disabled={busy} style={styles.submit}>
        {t(mode === 'signIn' ? OrganizationI18nKeys.SIGN_IN : OrganizationI18nKeys.REGISTER)}
      </OrgButton>
      <Text style={styles.hint}>
        {t(mode === 'register' ? OrganizationI18nKeys.REGISTER_HINT : OrganizationI18nKeys.SIGN_IN_HINT)}
      </Text>
    </SafeScrollView>
  )
}

export default OrganizationScreenView
