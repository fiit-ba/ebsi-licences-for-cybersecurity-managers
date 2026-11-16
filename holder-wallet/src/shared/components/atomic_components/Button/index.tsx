import { Button as BaseButton } from 'react-native-paper'
import styled from 'styled-components/native'
import { ColorKeys, getColorByBackground, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { CONTROL_HEIGHT, CONTROL_RADIUS } from '@shared/constants/ui'

const getBackgroundColor = (props: { disabled?: boolean; buttonColor?: string }) => {
  if (props.disabled) return getThemeColor(ColorKeys.disabled)
  return props.buttonColor ?? getThemeColor(ColorKeys.primary)
}
// The wallet's primary action. Paper owns the background/ripple while the
// shared geometry keeps every action usable on iOS and Android.
const ButtonStyled = styled(BaseButton).attrs((props) => ({
  mode: props.mode ?? 'contained',
  uppercase: props.uppercase ?? false,
  buttonColor: getBackgroundColor(props),
  textColor: getColorByBackground(ColorKeys.buttonText, getBackgroundColor(props)),
  labelStyle: {
    letterSpacing: 0.2,
    fontSize: 15,
    color: getColorByBackground(ColorKeys.buttonText, getBackgroundColor(props)),
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontWeight: '600',
  },
  // At least 240 wide, and wider for a longer label, up to the screen's width:
  // a fixed 240 cut Slovak labels short on every phone ("Naskenovať QR kód drži…").
  contentStyle: {
    height: CONTROL_HEIGHT,
    minWidth: 240,
    maxWidth: '100%',
    paddingHorizontal: 8,
    borderRadius: CONTROL_RADIUS,
  },
}))`
  border-radius: ${CONTROL_RADIUS}px;
  max-width: 100%;
`

export default ButtonStyled
