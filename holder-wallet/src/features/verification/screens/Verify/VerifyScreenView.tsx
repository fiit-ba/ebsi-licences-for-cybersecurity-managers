import { ActivityIndicator, Image, StatusBar, Text, View } from 'react-native'
import ButtonStyled from '@shared/components/atomic_components/Button'
import Outcome from './components/Outcome'
import SafeScrollView from '@shared/components/SafeScrollView'
import { screenStyles as styles } from './screen.styles'
import { VerifyScreenViewProps } from './screen.types'

const VerifyScreenView = ({
  phase,
  qrSide,
  primaryColor,
  warningColor,
  errorColor,
  recordNote,
  labels,
  start,
  retry,
  openOfflineScanner,
}: VerifyScreenViewProps) => (
  <SafeScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <StatusBar backgroundColor="transparent" barStyle="light-content" />
    {/* Verifying without the server needs neither the verification service nor its
        answer, only the holder's QR code (design decisions D33): it is offered while
        the service is being reached and when it cannot be. */}
    {phase.kind !== 'done' && (
      <>
        <ButtonStyled buttonColor={primaryColor} onPress={openOfflineScanner} style={styles.offline}>
          {labels.offlineScan}
        </ButtonStyled>
        <Text style={styles.muted}>{labels.offlineHint}</Text>
      </>
    )}
    {phase.kind === 'starting' && (
      <View style={[styles.waiting, styles.connecting]}>
        <ActivityIndicator color={primaryColor} />
        <Text style={styles.waitingText}>{labels.connecting}</Text>
      </View>
    )}
    {phase.kind === 'waiting' && (
      <>
        <Text style={[styles.intro, { marginTop: 18 }]}>{labels.intro}</Text>
        <View style={[styles.qrCard, { width: qrSide, height: qrSide }]}>
          <Image
            source={{ uri: phase.request.qr }}
            style={styles.qr}
            resizeMode="contain"
            accessibilityLabel={labels.qr}
          />
        </View>
        <View style={styles.waiting}>
          <ActivityIndicator color={primaryColor} />
          <Text style={styles.waitingText}>{labels.waiting}</Text>
        </View>
        <Text style={styles.muted}>{phase.expiresAt}</Text>
        <ButtonStyled buttonColor={primaryColor} onPress={start} style={styles.secondary}>
          {labels.newRequest}
        </ButtonStyled>
      </>
    )}
    {phase.kind === 'expired' && (
      <>
        <Text style={[styles.notice, styles.afterOffline, { borderLeftColor: warningColor }]}>{labels.expired}</Text>
        <ButtonStyled buttonColor={primaryColor} onPress={start} style={styles.primary}>
          {labels.newRequest}
        </ButtonStyled>
      </>
    )}
    {phase.kind === 'declined' && (
      <>
        <Text style={[styles.notice, styles.afterOffline, { borderLeftColor: warningColor }]}>{labels.declined}</Text>
        <ButtonStyled buttonColor={primaryColor} onPress={start} style={styles.primary}>
          {labels.newRequest}
        </ButtonStyled>
      </>
    )}
    {phase.kind === 'error' && (
      <>
        <Text style={[styles.notice, styles.afterOffline, { borderLeftColor: errorColor }]}>{phase.message}</Text>
        <ButtonStyled buttonColor={primaryColor} onPress={retry} style={styles.primary}>
          {labels.retry}
        </ButtonStyled>
      </>
    )}
    {phase.kind === 'done' && (
      <>
        <Outcome result={phase.result} />
        {recordNote !== '' && <Text style={styles.muted}>{recordNote}</Text>}
        <ButtonStyled buttonColor={primaryColor} onPress={start} style={styles.primary}>
          {labels.verifyAnother}
        </ButtonStyled>
      </>
    )}
  </SafeScrollView>
)

export default VerifyScreenView
