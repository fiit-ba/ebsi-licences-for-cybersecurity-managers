// Restoring a wallet from its security phrase (design decisions D31).
// The twelve words give the identity key back, and with it the same DID -
// derived here, never sent anywhere. The keys of the encrypted backup come
// from the same key, so the certificates follow from the back-office, which
// holds them only as a ciphertext under an address it cannot link to the DID.
import { StatusBar } from 'expo-status-bar'
import SetupTopBar from '@shared/components/SetupTopBar'
import RegisterStyles from '@features/registration/screens/Register/screen.styles'
import SafeScrollView from '@shared/components/SafeScrollView'
import { Hint, PhraseInput } from './screen.styles'
import { RestoreScreenViewProps } from './screen.types'

const RestoreScreenView = ({
  phrase,
  pin,
  secondPin,
  busy,
  ready,
  phraseError,
  pinError,
  statusBarStyle,
  spinnerColor,
  goBack,
  setPhrase,
  setPin,
  setSecondPin,
  confirm,
  labels,
}: RestoreScreenViewProps) => {
  return (
    <RegisterStyles.MainContainer>
      <StatusBar style={statusBarStyle} />
      <SetupTopBar style={{ marginBottom: 19 }}>
        <RegisterStyles.RecoveryButton icon="arrow-left" disabled={busy} onPress={goBack}>
          {labels.goBack}
        </RegisterStyles.RecoveryButton>
      </SetupTopBar>
      <SafeScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <RegisterStyles.Title>{labels.title}</RegisterStyles.Title>
        <RegisterStyles.Subtitle>{labels.subtitle}</RegisterStyles.Subtitle>

        <PhraseInput
          testID="restore-phrase"
          disabled={busy}
          value={phrase}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          keyboardType="visible-password"
          onChangeText={setPhrase}
          placeholder={labels.phrase}
        />
        <Hint>{labels.wordCount}</Hint>
        {phraseError !== '' && <RegisterStyles.ErrorText>{phraseError}</RegisterStyles.ErrorText>}

        <RegisterStyles.InputStyled
          testID="restore-pin"
          disabled={busy}
          value={pin}
          keyboardType="decimal-pad"
          secureTextEntry
          onChangeText={setPin}
          placeholder={labels.pin}
          style={{ marginTop: 18 }}
        />
        <RegisterStyles.InputStyled
          testID="restore-second-pin"
          disabled={busy}
          value={secondPin}
          keyboardType="decimal-pad"
          secureTextEntry
          onChangeText={setSecondPin}
          placeholder={labels.secondPin}
        />
        {pinError !== '' && <RegisterStyles.ErrorText>{pinError}</RegisterStyles.ErrorText>}

        <RegisterStyles.ContainerBottom>
          {busy ? <RegisterStyles.SplashActivityIndicator color={spinnerColor} size={35} /> : null}
          <RegisterStyles.Button testID="restore-button" disabled={!ready} onPress={confirm}>
            {busy ? labels.loading : labels.button}
          </RegisterStyles.Button>
        </RegisterStyles.ContainerBottom>
      </SafeScrollView>
    </RegisterStyles.MainContainer>
  )
}

export default RestoreScreenView
