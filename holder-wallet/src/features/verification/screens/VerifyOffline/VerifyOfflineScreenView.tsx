// Verifying a certificate without the server (design decisions D33).
// The holder's QR code invites this phone to an exchange on the holder's own
// phone. It asks there for the certificate - which fields it must see and
// which it would like - and checks what comes back itself: the issuer's
// signature, the holder binding, the trust chain, the schema and the standing
// on the governance contract, from EBSI's registries and the Ledger API. The
// answer reads as the console's does (features/verification/screens/Verify/components/Outcome), with the state
// "not valid" for a certificate suspended or revoked.
import { ActivityIndicator, Text, View } from 'react-native'
import ButtonStyled from '@shared/components/atomic_components/Button'
import Outcome from '@features/verification/screens/Verify/components/Outcome'
import SafeScrollView from '@shared/components/SafeScrollView'
import { screenStyles as styles } from './screen.styles'
import { VerifyOfflineScreenViewProps } from './screen.types'

const VerifyOfflineScreenView = ({
  phase,
  primaryColor,
  warningColor,
  errorColor,
  waitingText,
  checkingText,
  missingFieldsText,
  scanAgainText,
  scanAgain,
}: VerifyOfflineScreenViewProps) => {
  return (
    <SafeScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {(phase.kind === 'asking' || phase.kind === 'checking') && (
        <View style={styles.waiting}>
          <ActivityIndicator color={primaryColor} />
          <Text style={styles.waitingText}>{phase.kind === 'asking' ? waitingText : checkingText}</Text>
        </View>
      )}

      {phase.kind === 'done' && (
        <>
          <Outcome result={phase.result} />
          {phase.result.missingFields.length > 0 && (
            <Text style={[styles.notice, { borderLeftColor: warningColor }]}>{missingFieldsText}</Text>
          )}
          <ButtonStyled onPress={scanAgain} style={styles.primary}>
            {scanAgainText}
          </ButtonStyled>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Text style={[styles.notice, { borderLeftColor: errorColor }]}>{phase.message}</Text>
          <ButtonStyled onPress={scanAgain} style={styles.primary}>
            {scanAgainText}
          </ButtonStyled>
        </>
      )}
    </SafeScrollView>
  )
}

export default VerifyOfflineScreenView
