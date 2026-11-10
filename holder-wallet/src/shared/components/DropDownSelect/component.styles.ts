import styled from 'styled-components/native'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
// Uses Expo's autolinked icons and their current styled-components typing.
import { MaterialIcons as Icon } from '@expo/vector-icons'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { safeStyledText } from '@shared/components/atomic_components/Text'

const DropDownStyled = {
  RelativeView: styled.View<{ withListArrow?: boolean }>`
    position: relative;
    width: auto;
    top: ${({ withListArrow }) => (withListArrow ? '10px' : '0px')};
  `,
  DropDownContainer: styled.View`
    z-index: 10;
  `,
  DropDownTouchableContainer: styled.TouchableOpacity`
    display: flex;
    flex-direction: row;
    align-items: center;
  `,
  DescriptionText: safeStyledText(DescriptionText)<{
    open: boolean
    theme?: 'dark' | 'light'
    activationColor?: string
  }>`
		color: ${({ open, theme, activationColor }: any) =>
      open
        ? activationColor
          ? getThemeColor(ColorKeys.primary, theme)
          : getThemeColor(ColorKeys.text, theme)
        : getThemeColor(ColorKeys.text, theme)};
	`,
  // Supplies the current generic attrs type so the open prop remains type-safe.
  Icon: styled(Icon).attrs<{ open: boolean }>(({ open }) => ({
    name: `expand-${open ? 'less' : 'more'}`,
  }))<{
    open: boolean
    theme?: 'dark' | 'light'
    activationColor?: string
  }>`
    margin-left: 20px;
    color: ${({ open, theme, activationColor }) =>
      open
        ? activationColor
          ? getThemeColor(ColorKeys.primary, theme)
          : getThemeColor(ColorKeys.text, theme)
        : getThemeColor(ColorKeys.text, theme)};
  `,
}

export default DropDownStyled
