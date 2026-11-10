import React from 'react'
import { TouchableOpacity } from 'react-native'
import CheckBoxStyled from '@shared/components/atomic_components/CheckBox'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { ConfigurationType } from '@shared/components/DropDownSelect/type'
import DropDownItemStyled from '@shared/components/DropDownSelect/components/DropDownItem/styled'
interface Props {
  isSelected: boolean
  text: string
  onPress: () => void
  configuration?: ConfigurationType
}
const DropDownItem = (props: Props) => {
  return (
    <DropDownItemStyled.TouchableOpacity onPress={props.onPress}>
      {props.configuration?.withItemCheckBox !== false && <CheckBoxStyled checked={props.isSelected} />}
      <DescriptionText>{props.text}</DescriptionText>
    </DropDownItemStyled.TouchableOpacity>
  )
}

export default DropDownItem
