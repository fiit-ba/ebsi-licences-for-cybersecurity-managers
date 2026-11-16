import styled from 'styled-components'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import SecuredInput from '@shared/components/atomic_components/InputStyled/components/SecuredInput'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { CONTROL_RADIUS, INPUT_HEIGHT } from '@shared/constants/ui'

const InputStyled = styled(SecuredInput).attrs((props) => {
  return {
    selectionColor: getThemeColor(ColorKeys.primary),
    errorStyle: {
      color: getThemeColor(ColorKeys.error),
    },
    containerStyle: {
      paddingHorizontal: 0,
    },
    inputContainerStyle: {
      marginTop: 10,
    },
    inputStyle: {
      fontSize: 16,
    },

    placeholderTextColor: getThemeColor(ColorKeys.placeholder),
    underlineColor: getThemeColor(ColorKeys.placeholder),
    // A single, touch-friendly field shape for compact and large devices.
    theme: { roundness: CONTROL_RADIUS, colors: { primary: getThemeColor(ColorKeys.primary) } },
    outlineStyle: { borderRadius: CONTROL_RADIUS },
    activeOutlineColor: getThemeColor(ColorKeys.primary),
    outlineColor: getThemeColor(ColorKeys.placeholder),
    contentStyle: {
      minHeight: INPUT_HEIGHT,
      lineHeight: 25,
      fontFamily: FONT_FAMILY.PRINCIPAL,
    },
    mode: props.mode ?? 'outlined',
  }
})<any>`
  min-height: ${INPUT_HEIGHT}px;
  border-radius: ${CONTROL_RADIUS}px;
`

export const safeStyledInput = (component: any): any => {
  try {
    return styled(component)
  } catch (error) {
    return styled(SecuredInput)
  }
}

export default InputStyled
