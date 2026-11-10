import { Dispatch, SetStateAction } from 'react'
import { TextStyle, ViewStyle } from 'react-native'
import { ConfigurationType } from './type'

export interface DropDownSelectProps {
  title: string
  data: Record<string, any>
  onChange: (selectedData: any) => void
  backgroundColor?: string
  containerStyle: ViewStyle
  withListArrow?: boolean
  listArrowPosition?: 'left' | 'center' | 'right'
  configuration?: ConfigurationType
  titleStyle?: TextStyle
  activationColor?: string
  multiple?: boolean
  valueContentStyle?: ViewStyle
  itemContainerStyle?: ViewStyle
  testID?: string
}

export interface DropDownSelectViewProps extends DropDownSelectProps {
  isExpand: boolean
  selectedData: Record<string, boolean>
  theme: any
  setIsExpand: Dispatch<SetStateAction<boolean>>
  toggleItem: (key: string) => void
}
