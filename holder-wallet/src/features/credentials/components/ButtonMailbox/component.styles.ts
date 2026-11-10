import styled from 'styled-components/native'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CONTROL_HEIGHT, CONTROL_RADIUS } from '@shared/constants/ui'
// Reserves the complete button height in the empty-state layout.
export const ButtonContainer = styled.View`
  min-height: ${CONTROL_HEIGHT}px;
  align-items: center;
  justify-content: center;
`
// Matches the rounded scan action, accepts its responsive width and retains the
// shared button typography.
interface ActionWidthProps {
  $width?: number
}

export const RefreshButton = styled(ButtonStyled).attrs<ActionWidthProps>((props) => ({
  contentStyle: {
    height: CONTROL_HEIGHT,
    width: props.$width ?? 240,
    borderRadius: CONTROL_RADIUS,
    backgroundColor: getThemeColor(ColorKeys.primary),
  },
}))<ActionWidthProps>`
  border-radius: ${CONTROL_RADIUS}px;
`

export const LoadingContainer = styled.View<ActionWidthProps>`
  height: ${CONTROL_HEIGHT}px;
  width: ${({ $width }) => $width ?? 240}px;
  align-items: center;
  justify-content: center;
`
