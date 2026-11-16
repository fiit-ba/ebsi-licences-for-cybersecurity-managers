import styled from 'styled-components/native'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
// Uses Expo's autolinked icon package instead of the removed manually linked package.
import { MaterialIcons as Icon } from '@expo/vector-icons'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

const DropDownItemStyled = {
  TouchableOpacity: styled.TouchableOpacity<{ withListArrow?: boolean }>`
    flex-direction: row;
    padding: 5px;
    align-items: center;
  `,
}

export default DropDownItemStyled
