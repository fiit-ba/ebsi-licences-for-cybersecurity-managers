// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import React from 'react'
// Platform, to choose where the PDF is written (generatePDF below).
import { View } from 'react-native'
import ConfirmationDialog from '@shared/components/ConfirmationDialog'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { componentStyles as styles } from './component.styles'
import { PdfGeneratorViewProps } from './component.types'

const PdfGeneratorView: React.FC<PdfGeneratorViewProps> = ({
  isDialogVisible,
  buttonLabel,
  dialogTitle,
  dialogDescription,
  showDialog,
  share,
  hideDialog,
}) => {
  return (
    <View style={styles.actions}>
      {/*
          Export is a primary action, so it uses the same filled control as
          refresh, request and confirmation actions. */}
      <ButtonStyled icon={'share'} onPress={showDialog} onLongPress={showDialog}>
        {buttonLabel}
      </ButtonStyled>

      <ConfirmationDialog
        visible={isDialogVisible}
        titleLabel={dialogTitle}
        message={dialogDescription}
        onPress={share}
        onCancel={hideDialog}
      />
    </View>
  )
}

export default PdfGeneratorView
