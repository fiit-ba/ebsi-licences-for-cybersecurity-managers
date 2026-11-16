import styled from 'styled-components/native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { CONTROL_RADIUS } from '@shared/constants/ui'

const RequestCredentialModalStyled = {
  // Flexible, scrollable modal sections fit compact screens and larger text sizes.
  ModalContainer: styled.View`
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
    keyboardShouldPersistTaps: 'handled',
  })`
    flex: 1;
  `,
  ModalTextContent: styled.View`
    flex-direction: row;
    align-items: flex-start;
  `,
  ButtonContainer: styled.View`
    flex-direction: row;
    justify-content: center;
    padding: 12px 20px 16px 20px;
  `,
  DropDownPickerContainer: styled.View`
    margin-top: 30px;
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
		margin-right: 4px;
	`,
  ModalValueText: safeStyledText(DescriptionText)`
		flex: 1;
		min-width: 0px;
	`,
}

export default RequestCredentialModalStyled
