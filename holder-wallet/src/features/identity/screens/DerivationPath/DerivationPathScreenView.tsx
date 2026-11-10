import React from 'react'
import { Card } from 'react-native-paper'
import Button from '@shared/components/atomic_components/Button'
import PressToCopy from '@shared/components/PressToCopy'
import DerivationPathStyled from '@features/identity/screens/DerivationPath/screen.styles'
// The language switch at the top of the screen.
import SetupTopBar from '@shared/components/SetupTopBar'
import { DerivationPathScreenViewProps } from './screen.types'

const DerivationPathScreenView = ({
  derivationPath,
  isSeedBlur,
  isCreatingDid,
  goBack,
  toggleSeedVisibility,
  finish,
  labels,
}: DerivationPathScreenViewProps) => {
  return (
    <DerivationPathStyled.MainContainer>
      {/*
			    Puts the back button and the language switch in one row. */}
      <SetupTopBar style={{ marginBottom: 10 }}>
        <DerivationPathStyled.BackButton onPress={goBack}>{labels.goBack}</DerivationPathStyled.BackButton>
      </SetupTopBar>
      <DerivationPathStyled.Container>
        <DerivationPathStyled.Title testID="title">{labels.title}</DerivationPathStyled.Title>
        <DerivationPathStyled.Subtitle>{labels.subtitle}</DerivationPathStyled.Subtitle>

        {isSeedBlur ? (
          <DerivationPathStyled.PhraseContainer onPress={toggleSeedVisibility}>
            <DerivationPathStyled.MainCard justifyContent="flex-end" alignItems="center">
              <Card.Content>
                <DerivationPathStyled.HiddenTitle>{labels.hiddenTitle}</DerivationPathStyled.HiddenTitle>
              </Card.Content>
            </DerivationPathStyled.MainCard>
          </DerivationPathStyled.PhraseContainer>
        ) : (
          <DerivationPathStyled.PhraseContainer>
            <PressToCopy onPress={toggleSeedVisibility} value={derivationPath}>
              <DerivationPathStyled.MainCard>
                <Card.Content>
                  <DerivationPathStyled.Content>{derivationPath}</DerivationPathStyled.Content>
                </Card.Content>
              </DerivationPathStyled.MainCard>
            </PressToCopy>
          </DerivationPathStyled.PhraseContainer>
        )}
        {!isSeedBlur && <DerivationPathStyled.CopyText>{labels.longPress}</DerivationPathStyled.CopyText>}

        <DerivationPathStyled.ContainerBottom>
          {/*
					    Finishes the setup here (finish, above). */}
          <Button loading={isCreatingDid} disabled={isCreatingDid} onPress={finish}>
            {labels.button}
          </Button>
        </DerivationPathStyled.ContainerBottom>
      </DerivationPathStyled.Container>
    </DerivationPathStyled.MainContainer>
  )
}

export default DerivationPathScreenView
