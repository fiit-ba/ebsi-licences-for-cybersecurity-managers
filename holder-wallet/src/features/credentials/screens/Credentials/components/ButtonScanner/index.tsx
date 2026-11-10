import React from 'react'
import ActionButton, { ButtonContainer } from '@shared/components/atomic_components/ActionButton'
import { TEST_LABELS } from '@features/credentials/screens/Credentials/constants/testLabels'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import CredentialsI18nKeys from '@features/credentials/screens/Credentials/i18n/keys'
import { MaterialIcons } from '@expo/vector-icons'
// Lets the responsive actions row allocate enough width for translated labels.
interface Props {
  onPress?: () => void
  size?: number
}
const ButtonScanner = (props: Props) => {
  const { t } = useTranslation(SCREEN.Credentials)
  return (
    <ButtonContainer>
      {/*
          Uses the width allocated by the responsive actions row. */}
      <ActionButton
        buttonColor={getThemeColor(ColorKeys.primary)}
        testID={TEST_LABELS.ActionButton}
        size={props.size ?? 144}
        onPress={props.onPress}
        icon={() => <MaterialIcons name="qr-code-scanner" size={32} color={getThemeColor(ColorKeys.buttonText)} />}
      >
        {t(CredentialsI18nKeys.BUTTON_SCAN)}
      </ActionButton>
    </ButtonContainer>
  )
}

export default ButtonScanner
