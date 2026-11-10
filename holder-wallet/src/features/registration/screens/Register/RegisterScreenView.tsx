import { testID } from '@features/registration/screens/Register/constants/testID'
import RegisterStyles from '@features/registration/screens/Register/screen.styles'
import { StatusBar } from 'expo-status-bar'
// Imports the colour scheme the app started with (src/constants/Colors.ts).
// The way to restoring a wallet (features/recovery/screens/Restore, D31).
import { Button as PaperButton } from 'react-native-paper'
// The language switch at the top of the screen.
import SetupTopBar from '@shared/components/SetupTopBar'
// The way to the organization's profile, which is independent of this wallet
// (design decisions D15, D18).
import { OrgButton } from '@features/organization/components/Organization'
import { RegisterScreenViewProps } from './screen.types'

const RegisterScreenView = ({
  firstPin,
  secondPin,
  isLoading,
  isPinFilled,
  isTermsChecked,
  hasWallet,
  errorMessage,
  statusBarStyle,
  textColor,
  primaryColor,
  labels,
  setFirstPin,
  setSecondPin,
  toggleTerms,
  openTerms,
  submit,
  goLogin,
  goRestore,
  goVerify,
  goOrganization,
}: RegisterScreenViewProps) => {
  return (
    <RegisterStyles.MainContainer>
      {/*
			    Uses Expo 57's status bar API and sets it from the colour scheme the app started with
			    (src/constants/Colors.ts). Sign-in is offered only once a wallet exists. */}
      <StatusBar style={statusBarStyle} />
      {/*
			    Puts sign-in and the language switch in one row at the top. */}
      <SetupTopBar style={{ marginBottom: 19 }}>
        {hasWallet && <RegisterStyles.RecoveryButton onPress={goLogin}>{labels.login}</RegisterStyles.RecoveryButton>}
      </SetupTopBar>
      {/*
			    Says whose registration this is: a certificate holder's. An
			    organization's profile is created on the Organization screen (D18). */}
      <RegisterStyles.Title>{labels.title}</RegisterStyles.Title>
      <RegisterStyles.Subtitle>{labels.subtitle}</RegisterStyles.Subtitle>

      <RegisterStyles.InputsContainer>
        <RegisterStyles.InputStyled
          disabled={isLoading}
          testID={testID.FIRST_PIN_INPUT}
          value={firstPin}
          keyboardType="decimal-pad"
          secureTextEntry
          onChangeText={setFirstPin}
          placeholder={labels.pin}
          returnKeyType={'next'}
        />
        <RegisterStyles.InputStyled
          disabled={isLoading}
          testID={testID.SECOND_PIN_INPUT}
          value={secondPin}
          keyboardType="decimal-pad"
          secureTextEntry
          onChangeText={setSecondPin}
          placeholder={labels.secondPin}
          returnKeyType={'done'}
        />
        {errorMessage !== '' && (
          <RegisterStyles.ErrorText testID={testID.REGISTER_ERROR_MESSAGE}>{errorMessage}</RegisterStyles.ErrorText>
        )}
        <RegisterStyles.CheckBoxContainer>
          <RegisterStyles.TermsCheckBox testID={testID.TERMS_CHECKBOX} checked={isTermsChecked} onPress={toggleTerms} />
          <RegisterStyles.TermsText onPress={openTerms}>{labels.conditions}</RegisterStyles.TermsText>
        </RegisterStyles.CheckBoxContainer>
      </RegisterStyles.InputsContainer>

      <RegisterStyles.ContainerBottom>
        {isLoading ? <RegisterStyles.SplashActivityIndicator color={textColor} size={35} /> : null}
        <RegisterStyles.Button
          testID={testID.REGISTER_BUTTON}
          disabled={isPinFilled || !isTermsChecked || isLoading}
          onPress={submit}
        >
          {isLoading ? labels.loading : labels.button}
        </RegisterStyles.Button>
        {/*
				    A wallet that exists already comes back from its security phrase (D31). */}
        <PaperButton
          testID="register-restore"
          mode="text"
          icon="backup-restore"
          disabled={isLoading}
          textColor={primaryColor}
          style={{ marginTop: 6 }}
          onPress={goRestore}
        >
          {labels.restore}
        </PaperButton>
        {/*
				    Someone who only wants to check a certificate needs no wallet: the
				    verifier works without registration (component 6), and it is offered
				    as a button of its own, not a link. */}
        <RegisterStyles.Or>
          <RegisterStyles.OrLine />
          <RegisterStyles.OrText>{labels.or}</RegisterStyles.OrText>
          <RegisterStyles.OrLine />
        </RegisterStyles.Or>
        <RegisterStyles.VerifyButton disabled={isLoading} onPress={goVerify}>
          {labels.verify}
        </RegisterStyles.VerifyButton>
        <RegisterStyles.VerifyHint>{labels.verifyHint}</RegisterStyles.VerifyHint>
        {/*
				    The way in for an organization, in its own colour (design decisions D15, D18). */}
        <OrgButton icon="domain" disabled={isLoading} onPress={goOrganization} style={{ marginTop: 18 }}>
          {labels.organization}
        </OrgButton>
      </RegisterStyles.ContainerBottom>
    </RegisterStyles.MainContainer>
  )
}

export default RegisterScreenView
