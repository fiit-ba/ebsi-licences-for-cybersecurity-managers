import { ButtonProps } from 'react-native-paper'
import styled from 'styled-components/native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import ButtonStyled from '@shared/components/atomic_components/Button'
interface Props {
  size?: number
  disabled?: boolean
  buttonColor?: string
}

const ActionButton = styled(ButtonStyled).attrs((props: Props) => ({
  mode: 'contained',
  contentStyle: {
    height: 48,
    width: props.size ?? 120,
    borderRadius: 16,
    backgroundColor: props.disabled ? getThemeColor(ColorKeys.disabled) : props.buttonColor,
  },
}))<ButtonProps & Props>`
  border-radius: 16px;
  align-items: center;
  justify-content: center;
`

export const ButtonContainer = styled.View`
  /*
		 The parent action group controls responsive placement; this wrapper adds
		 no full-width background or absolute overlay of its own. */
  border-radius: 16px;
`

export default ActionButton
