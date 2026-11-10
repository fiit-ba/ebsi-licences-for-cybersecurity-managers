// useEffect: the list follows the wallet's writes (below).
import { StatusBar } from 'react-native'
import CredentialStyled from '@features/credentials/screens/Credentials/screen.styles'
import Placeholder from '@shared/components/Placeholder'
import CredentialList from '@features/credentials/screens/Credentials/components/CredentialList'
import ButtonScanner from '@features/credentials/screens/Credentials/components/ButtonScanner'
import StateWrapper from '@shared/components/wrappers/StateWrapper'
import ButtonMailbox from '@features/credentials/components/ButtonMailbox'
// Presenting a certificate phone to phone, without the server (D33).
import { Button } from 'react-native-paper'
import { CredentialsScreenViewProps } from './screen.types'

const CredentialsScreenView = ({
  childRef,
  stackActions,
  scanActionWidth,
  refreshActionWidth,
  primaryColor,
  loadCredentials,
  reloadCredentials,
  openScanner,
  openPresentation,
  placeholderTitle,
  placeholderText,
  presentLabel,
}: CredentialsScreenViewProps) => {
  return (
    <CredentialStyled.ContentView>
      <StatusBar backgroundColor="transparent" barStyle="light-content" />
      {/*
          Primary actions live above the scrollable content: no absolute FAB,
          no full-width footer, and no certificate content hidden underneath.
          Compact devices stack the actions instead of squeezing their labels. */}
      <CredentialStyled.ActionsContainer $stacked={stackActions}>
        <ButtonMailbox actionWidth={refreshActionWidth} onUpdated={reloadCredentials} />
        <ButtonScanner size={scanActionWidth} onPress={openScanner} />
      </CredentialStyled.ActionsContainer>
      {/*
          The holder shows a QR code; the verifier's phone connects to this one (D33). */}
      <Button
        testID="credentials-present"
        mode="outlined"
        icon="qrcode"
        textColor={primaryColor}
        style={{ alignSelf: 'center', marginBottom: 10, borderColor: primaryColor }}
        onPress={openPresentation}
      >
        {presentLabel}
      </Button>
      <StateWrapper
        ref={childRef}
        initialFunction={loadCredentials}
        emptyStateCondition={(credentials) => !credentials.length}
        renderEmptyState={<Placeholder placeholderTitle={placeholderTitle} placeholderText={placeholderText} />}
        renderData={(credentials) => <CredentialList credentials={credentials} />}
      />
    </CredentialStyled.ContentView>
  )
}

export default CredentialsScreenView
