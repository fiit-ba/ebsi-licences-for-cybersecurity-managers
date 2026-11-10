import styled from 'styled-components/native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { KeyboardAvoidingView, Platform } from 'react-native'
import { CONTROL_RADIUS } from '@shared/constants/ui'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

const RequestPreauthorizeUserPinModalStyled = {
  // Keeps the PIN field and actions visible above the keyboard on iOS and Android.
  ModalContainer: styled(KeyboardAvoidingView).attrs({
    behavior: Platform.OS === 'ios' ? 'padding' : undefined,
  })`
    justify-content: space-between;
    flex: 1;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  CredentialContainer: styled.View`
    margin-top: 12px;
    margin-bottom: 12px;
  `,
  ModalContent: styled.ScrollView.attrs({
    contentContainerStyle: { padding: 20, paddingTop: 30 },
    keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag',
    keyboardShouldPersistTaps: 'handled',
  })`
    flex: 1;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  ModalTextContent: styled.View`
    flex-direction: row;
  `,
  ButtonContainer: styled.View`
    /*
		   index.tsx increases only the bottom padding while a real keyboard is open. */
    flex-direction: row;
    justify-content: center;
    padding: 12px 20px 16px 20px;
  `,
  DropDownPickerContainer: styled.View`
    margin-top: 24px;
  `,
  // The label is centred on the top outline. Its rounded background masks a
  // short part of the line without the sharp corners of Paper's default notch.
  InputFrame: styled.View`
    position: relative;
  `,
  InputLabel: styled.Text<{ $focused: boolean }>`
    position: absolute;
    /*
		   A 20px label sits exactly halfway across the input's top border. */
    top: -10px;
    left: 14px;
    z-index: 2;
    padding: 0 9px;
    border-radius: 10px;
    background-color: ${getThemeColor(ColorKeys.background)};
    font-family: ${FONT_FAMILY.PRINCIPAL};
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    color: ${({ $focused }) => getThemeColor($focused ? ColorKeys.primary : ColorKeys.mutedText)};
  `,
  Button: styled(ButtonStyled).attrs({
    contentStyle: {
      width: 224,
      borderRadius: CONTROL_RADIUS,
      backgroundColor: getThemeColor(ColorKeys.primary),
    },
  })``,
  ModalText: safeStyledText(DescriptionText)``,

  ModalBoldText: safeStyledText(DescriptionText)`
		font-weight: bold;
	`,
}

export default RequestPreauthorizeUserPinModalStyled
