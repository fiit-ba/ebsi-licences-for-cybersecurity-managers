import Button from '@shared/components/atomic_components/Button'
import InputStyled from '@shared/components/atomic_components/InputStyled'
import SeedButton from '@features/recovery/components/SeedButton'
import SecurityPhraseConfirmStyled from '@features/recovery/screens/SecurityPhraseConfirm/screen.styles'
// The language switch at the top of the screen.
import SetupTopBar from '@shared/components/SetupTopBar'
// Imports storage, to mark the wallet created only once its security phrase is
// confirmed.
import { SecurityPhraseConfirmScreenViewProps } from './screen.types'

const SecurityPhraseConfirmScreenView = ({
  seedPhrase,
  showedPhrase,
  goBack,
  selectWord,
  resetSeeds,
  confirmSeeds,
  labels,
}: SecurityPhraseConfirmScreenViewProps) => {
  return (
    <SecurityPhraseConfirmStyled.MainContainer>
      <SecurityPhraseConfirmStyled.Container>
        {/*
				    Puts the back button and the language switch in one row. */}
        <SetupTopBar style={{ marginBottom: 20 }}>
          <SecurityPhraseConfirmStyled.RecoveryButton onPress={goBack}>
            {labels.goBack}
          </SecurityPhraseConfirmStyled.RecoveryButton>
        </SetupTopBar>
        <SecurityPhraseConfirmStyled.Title testID={'title'}>{labels.title}</SecurityPhraseConfirmStyled.Title>
        <InputStyled
          style={{ height: 120 }}
          editable={false}
          multiline
          label={labels.inputLabel}
          value={showedPhrase.join(' ')}
          placeholder={labels.inputPlaceholder}
        ></InputStyled>

        <SecurityPhraseConfirmStyled.ButtonContainer>
          {seedPhrase.map((word, index) => {
            return (
              <SeedButton
                text={word}
                key={`SeedButton-${word}-${index}`}
                onPress={() => {
                  selectWord(word)
                }}
              />
            )
          })}
        </SecurityPhraseConfirmStyled.ButtonContainer>
        <SecurityPhraseConfirmStyled.ResetButton
          disabled={showedPhrase.length < 1}
          onPress={() => {
            resetSeeds()
          }}
        >
          {labels.reset}
        </SecurityPhraseConfirmStyled.ResetButton>

        <SecurityPhraseConfirmStyled.ContainerBottom>
          <Button
            disabled={showedPhrase.length < 12}
            onPress={() => {
              confirmSeeds()
            }}
          >
            {labels.confirm}
          </Button>
        </SecurityPhraseConfirmStyled.ContainerBottom>
      </SecurityPhraseConfirmStyled.Container>
    </SecurityPhraseConfirmStyled.MainContainer>
  )
}

export default SecurityPhraseConfirmScreenView
