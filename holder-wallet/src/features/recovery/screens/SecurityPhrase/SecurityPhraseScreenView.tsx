import { Card } from 'react-native-paper'
import Button from '@shared/components/atomic_components/Button'
import PressToCopy from '@shared/components/PressToCopy'
import SecurityPhraseStyled from '@features/recovery/screens/SecurityPhrase/screen.styles'
import { StatusBar } from 'expo-status-bar'
// The language switch at the top of the screen.
import SetupTopBar from '@shared/components/SetupTopBar'
import { SecurityPhraseScreenViewProps } from './screen.types'

const SecurityPhraseScreenView = ({
  seedPhrase,
  isSeedBlur,
  statusBarStyle,
  goBack,
  toggleSeedVisibility,
  confirmPhrase,
  labels,
}: SecurityPhraseScreenViewProps) => {
  return (
    <SecurityPhraseStyled.MainContainer>
      {/*
          Uses Expo 57's status bar API and sets it from the colour scheme the app started with
          (src/constants/Colors.ts). */}
      <StatusBar style={statusBarStyle} />
      <SecurityPhraseStyled.Container>
        {/*
            Puts the back button and the language switch in one row. */}
        <SetupTopBar style={{ marginBottom: 20 }}>
          <SecurityPhraseStyled.BackButton onPress={goBack}>{labels.goBack}</SecurityPhraseStyled.BackButton>
        </SetupTopBar>
        <SecurityPhraseStyled.Title testID={'title'}>{labels.title}</SecurityPhraseStyled.Title>
        <SecurityPhraseStyled.Subtitle>{labels.subtitle}</SecurityPhraseStyled.Subtitle>

        {isSeedBlur ? (
          <SecurityPhraseStyled.PhraseContainer onPress={toggleSeedVisibility}>
            <SecurityPhraseStyled.MainCard justifyContent="flex-end" alignItems="center">
              <Card.Content>
                <SecurityPhraseStyled.HiddenTitle>{labels.hiddenTitle}</SecurityPhraseStyled.HiddenTitle>
              </Card.Content>
            </SecurityPhraseStyled.MainCard>
          </SecurityPhraseStyled.PhraseContainer>
        ) : (
          <SecurityPhraseStyled.PhraseContainer>
            <PressToCopy onPress={toggleSeedVisibility} value={seedPhrase}>
              <SecurityPhraseStyled.MainCard>
                <Card.Content>
                  <SecurityPhraseStyled.Content>{seedPhrase}</SecurityPhraseStyled.Content>
                </Card.Content>
              </SecurityPhraseStyled.MainCard>
            </PressToCopy>
          </SecurityPhraseStyled.PhraseContainer>
        )}
        {!isSeedBlur && <SecurityPhraseStyled.CopyText>{labels.longPress}</SecurityPhraseStyled.CopyText>}

        <SecurityPhraseStyled.ContainerBottom>
          <Button onPress={confirmPhrase}>{labels.button}</Button>
        </SecurityPhraseStyled.ContainerBottom>
      </SecurityPhraseStyled.Container>
    </SecurityPhraseStyled.MainContainer>
  )
}

export default SecurityPhraseScreenView
