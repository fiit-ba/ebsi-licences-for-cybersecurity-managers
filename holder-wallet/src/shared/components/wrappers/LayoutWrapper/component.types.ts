import { LayoutChangeEvent } from 'react-native'
import { ReactElement } from 'react'

export type LayoutWrapperChildren = ReactElement | ((component: any, props: any) => ReactElement)

export interface LayoutWrapperProps {
  childrenProps?: object | ((config?: any, dimensions?: any) => object)
  element: ReactElement
  children: LayoutWrapperChildren
}

export interface LayoutWrapperViewProps {
  measured: boolean
  children: ReactElement
  element: ReactElement
  onLayout: (event: LayoutChangeEvent) => void
}
