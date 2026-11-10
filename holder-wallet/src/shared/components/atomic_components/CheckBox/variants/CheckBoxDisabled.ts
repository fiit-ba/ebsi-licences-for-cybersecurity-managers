import styled from 'styled-components/native'
import CheckBoxStyled from '@shared/components/atomic_components/CheckBox'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

const CheckBoxDisabledStyled = styled(CheckBoxStyled).attrs({
  disabled: true,
  checkedColor: getThemeColor(ColorKeys.disabled),
  textStyle: {
    color: getThemeColor(ColorKeys.disabled),
    fontSize: 14,
    fontWeight: 'normal',
  },
})``
export default CheckBoxDisabledStyled
