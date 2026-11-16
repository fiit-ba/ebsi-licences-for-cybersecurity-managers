import React from 'react'
import { TextStyle, ViewStyle } from 'react-native'
import DropDownStyled from '@shared/components/DropDownSelect/component.styles'
import { ConfigurationType } from '@shared/components/DropDownSelect/type'
interface Props {
  activationColor?: string
  theme?: string
  value: string
  titleStyle?: TextStyle
  configuration?: ConfigurationType
  setIsExpand: (x: boolean) => void
  isExpand: boolean
  dropdownValueContentStyle?: ViewStyle
}
const DropDownValue = (props: Props) => {
  return (
    <DropDownStyled.DropDownTouchableContainer
      style={props.dropdownValueContentStyle}
      onPress={() => props.setIsExpand(!props.isExpand)}
    >
      <DropDownStyled.DescriptionText
        activationColor={props.activationColor}
        theme={props.theme}
        open={props.isExpand}
        style={props.titleStyle}
      >
        {props.value}
      </DropDownStyled.DescriptionText>
      {props.configuration?.withDropdownArrow !== false && (
        <DropDownStyled.Icon open={props.isExpand} activationColor={props.activationColor} theme={props.theme} />
      )}
    </DropDownStyled.DropDownTouchableContainer>
  )
}

export default DropDownValue
