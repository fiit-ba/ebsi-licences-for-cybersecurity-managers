import { ReactElement } from 'react'
import { StyleProp, ViewStyle } from 'react-native'

export type StateWrapperStatus = 'loading' | 'empty-state' | 'completed' | 'error'

export interface StateWrapperProps<T = any> {
  initialFunction: () => T | Promise<T>
  renderData: (data: T) => ReactElement
  emptyStateCondition?: (data: T) => boolean
  renderEmptyState?: ReactElement
  renderError?: (error: any) => ReactElement
  errorMessage?: () => ReactElement
  containerStyle?: StyleProp<ViewStyle>
}

export interface StateWrapperViewProps<T = any> extends Pick<
  StateWrapperProps<T>,
  'renderData' | 'renderEmptyState' | 'renderError' | 'containerStyle'
> {
  status: StateWrapperStatus
  data?: T | any
}
