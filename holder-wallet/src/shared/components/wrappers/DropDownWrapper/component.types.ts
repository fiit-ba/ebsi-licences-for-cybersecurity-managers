import { ReactElement } from 'react'
import { TextStyle, ViewStyle } from 'react-native'

export interface DropDownWrapperProps {
  title: string
  children: ReactElement
  titleStyle?: TextStyle
  style?: ViewStyle
  contentStyled?: ViewStyle
  wrapperStyle?: ViewStyle
  testID?: string
  duration?: { in?: number; out?: number } | number
}

export interface DropDownWrapperViewProps extends DropDownWrapperProps {
  isExpanded: boolean
  toggleExpanded: () => void
}
