import RegisterI18nKeys from '@features/authentication/screens/Login/i18n/keys'
import LoginStyled from '@features/authentication/screens/Login/screen.styles'
import { StatusBar } from 'expo-status-bar'
import { Platform } from 'react-native'
import { TextInput } from 'react-native-paper'
import { IMG } from '@shared/constants/urlImages'
import { BRAND } from '@shared/constants/brand'
import LanguageToggle from '@shared/components/LanguageToggle'
import { OrgButton } from '@features/organization/components/Organization'
import { localDate } from '@shared/utils/labels'
import { LoginScreenViewProps } from './screen.types'

const LoginScreenView = ({
  organization,
  pin,
  isLoading,
  compact,
  insets,
  tagline,
  placeholderColor,
  t,
  setPin,
  switchTo,
  goToRegister,
  goToVerify,
  unlock,
  unlockHolder,
  removeOrganization,
}: LoginScreenViewProps) => {
  return (
    <LoginStyled.Screen>
      {/*
          Removes the obsolete backgroundColor prop for Expo 57's status bar API. */}
      <StatusBar style="light" />
      <LoginStyled.Scroll
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom }}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <LoginStyled.Hero
          source={IMG.BRAND_BACKGROUND}
          style={{ paddingTop: insets.top + (compact ? 16 : 40), paddingBottom: compact ? 36 : 56 }}
        >
          {/*
              The language switch, before the holder signs in. */}
          <LoginStyled.LanguageCorner style={{ top: insets.top + 12 }}>
            <LanguageToggle />
          </LoginStyled.LanguageCorner>
          <LoginStyled.Mark source={IMG.BRAND_MARK} style={compact ? { width: 56, height: 56 } : undefined} />
          <LoginStyled.BrandName>{BRAND.NAME}</LoginStyled.BrandName>
          {/*
              The tagline in the active language. */}
          <LoginStyled.Tagline>{tagline}</LoginStyled.Tagline>
        </LoginStyled.Hero>

        <LoginStyled.Card>
          {/*
              Says whose sign-in this is: a certificate holder's, or an
              organization's, named, in its violet. */}
          {organization && <LoginStyled.OrgName>{organization.organization}</LoginStyled.OrgName>}
          <LoginStyled.Title testID="title">
            {t(organization ? RegisterI18nKeys.ORG_TITLE : RegisterI18nKeys.TITLE)}
          </LoginStyled.Title>
          {/*
              A revoked organization (D24): why it no longer signs in, and no PIN to type. */}
          {organization?.revoked ? (
            <>
              <LoginStyled.RevokedTitle testID="revoked">{t(RegisterI18nKeys.REVOKED_TITLE)}</LoginStyled.RevokedTitle>
              <LoginStyled.RevokedText>
                {t(organization.revoked.byTao ? RegisterI18nKeys.REVOKED_TEXT_TAO : RegisterI18nKeys.REVOKED_TEXT, {
                  date: localDate(organization.revoked.at),
                })}
              </LoginStyled.RevokedText>
            </>
          ) : (
            <>
              <LoginStyled.Hint>{t(organization ? RegisterI18nKeys.ORG_PIN : RegisterI18nKeys.PIN)}</LoginStyled.Hint>
              <LoginStyled.InputStyled
                disabled={isLoading}
                value={pin}
                keyboardType="decimal-pad"
                secureTextEntry
                // A lock icon in the PIN field.
                left={<TextInput.Icon icon="lock-outline" color={placeholderColor} />}
                onChangeText={setPin}
                placeholder={t(RegisterI18nKeys.PIN_LABEL) || ''}
                // Whichever profile is shown, with its own PIN.
                onSubmitEditing={unlock}
                returnKeyType={Platform.OS === 'android' ? 'send' : 'done'}
              />
              {/*
                  Uses one full-width action, with its progress shown inside the
                  button. */}
              {/*
                  An organization unlocks with its violet button. */}
              {organization ? (
                <OrgButton
                  testID="startButton"
                  disabled={pin === '' || isLoading}
                  loading={isLoading}
                  onPress={unlock}
                  style={{ alignSelf: 'stretch', marginTop: 16 }}
                  contentStyle={{ width: undefined, height: 52 }}
                  labelStyle={{ fontSize: 16 }}
                >
                  {t(RegisterI18nKeys.BUTTON)}
                </OrgButton>
              ) : (
                <LoginStyled.Button
                  testID="startButton"
                  disabled={pin === '' || isLoading}
                  loading={isLoading}
                  onPress={unlockHolder}
                >
                  {t(RegisterI18nKeys.BUTTON)}
                </LoginStyled.Button>
              )}
            </>
          )}
        </LoginStyled.Card>

        <LoginStyled.Footer style={{ paddingBottom: insets.bottom + 16 }}>
          {/*
              The other ways from here, before a new wallet: the other profile,
              which opens with its own PIN (D18), and verifying, which needs no
              sign-in at all. */}
          {organization ? (
            <LoginStyled.SwitchButton icon="account-outline" onPress={() => switchTo('holder')}>
              {t(RegisterI18nKeys.SWITCH_TO_HOLDER)}
            </LoginStyled.SwitchButton>
          ) : (
            <LoginStyled.OrgSwitchButton icon="domain" onPress={() => switchTo('organization')}>
              {t(RegisterI18nKeys.SIGN_IN_AS_ORG)}
            </LoginStyled.OrgSwitchButton>
          )}
          <LoginStyled.SwitchButton icon="shield-check-outline" onPress={goToVerify}>
            {t(RegisterI18nKeys.VERIFY)}
          </LoginStyled.SwitchButton>
          {/*
              A new wallet replaces the holder's; the organization's profile is
              not a wallet, and is deleted from its own menu (D18). */}
          {!organization && (
            <LoginStyled.RegisterButton onPress={goToRegister}>
              {t(RegisterI18nKeys.REGISTER_LINK)}
            </LoginStyled.RegisterButton>
          )}
          {/*
              A revoked organization's profile is removed from here (D24). */}
          {organization?.revoked && (
            <LoginStyled.SwitchButton icon="delete-outline" onPress={removeOrganization}>
              {t(RegisterI18nKeys.REMOVE_PROFILE)}
            </LoginStyled.SwitchButton>
          )}
        </LoginStyled.Footer>
      </LoginStyled.Scroll>
    </LoginStyled.Screen>
  )
}

export default LoginScreenView
