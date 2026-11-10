// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import { Dialog, Paragraph, Portal } from 'react-native-paper'
import { ButtonContainer, StyledButton } from '@shared/components/ConfirmationDialog/styles'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import i18next from 'i18next'
// Uses React 19's exported element type instead of the removed global JSX namespace.
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
// Removes the Spanish strings: the wallet offers Slovak and English.
import ConfirmationDialogI18nKeys from '@shared/components/ConfirmationDialog/i18n/keys'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
import localeSK from '@shared/components/ConfirmationDialog/i18n/sk'
import localeEN from '@shared/components/ConfirmationDialog/i18n/en'
// Returns React 19's exported element type instead of the removed global JSX type.
export default function ConfirmationDialog(props: {
  visible: boolean
  message?: string
  onCancel: () => void
  onPress: () => void
  titleLabel?: string
  cancelButtonLabel?: string
  continueButtonLabel?: string
  danger?: boolean
  children?: React.ReactNode
}): ReactElement {
  const bundle = 'ConfirmDialog'
  // Registers the Slovak strings and the English ones, for the language
  // switch; Spanish is no longer offered.
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)

  const titleLabel = props.titleLabel || t(ConfirmationDialogI18nKeys.DIALOG_TITLE)
  const cancelButtonLabel = props.cancelButtonLabel || t(ConfirmationDialogI18nKeys.BUTTON_CANCEL)
  const continueButtonLabel = props.continueButtonLabel || t(ConfirmationDialogI18nKeys.BUTTON_CONFIRM)

  return (
    <Portal>
      <Dialog
        visible={props.visible}
        dismissable={false}
        onDismiss={props.onCancel}
        style={{ backgroundColor: getThemeColor(ColorKeys.background) }}
      >
        <Dialog.Title style={{ fontWeight: 'bold' }}>{titleLabel}</Dialog.Title>
        <Dialog.Content>{props.message ? <Paragraph>{props.message}</Paragraph> : props.children}</Dialog.Content>
        <ButtonContainer>
          <Dialog.Actions>
            <StyledButton
              textColor={getThemeColor(ColorKeys.buttonText)}
              buttonColor={getThemeColor(ColorKeys.primary)}
              uppercase={false}
              onPress={props.onCancel}
            >
              {cancelButtonLabel}
            </StyledButton>
          </Dialog.Actions>
          <Dialog.Actions>
            <StyledButton
              textColor={getThemeColor(ColorKeys.buttonText)}
              buttonColor={props.danger ? 'red' : getThemeColor(ColorKeys.primary)}
              uppercase={false}
              onPress={props.onPress}
            >
              {continueButtonLabel}
            </StyledButton>
          </Dialog.Actions>
        </ButtonContainer>
      </Dialog>
    </Portal>
  )
}
