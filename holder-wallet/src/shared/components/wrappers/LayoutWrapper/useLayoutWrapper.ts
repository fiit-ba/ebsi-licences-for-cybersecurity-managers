import { useState, ReactElement } from 'react'
import { LayoutChangeEvent, LayoutRectangle } from 'react-native'
import { LayoutWrapperProps, LayoutWrapperViewProps } from './component.types'

const useLayoutWrapper = (props: LayoutWrapperProps): LayoutWrapperViewProps => {
  const [layout, setLayout] = useState<LayoutChangeEvent | null>(null)
  const [dimensions, setDimensions] = useState<LayoutRectangle | null>(null)
  let childrenProps: any = {}
  if (props.childrenProps && typeof props.childrenProps === typeof {}) childrenProps = props.childrenProps
  else if (props.childrenProps && layout && dimensions)
    childrenProps = (props.childrenProps as Function)(layout, dimensions)
  else if (layout && dimensions) childrenProps = { layout, dimensions }

  const selected = props.children || props.element
  const children: ReactElement = typeof selected === 'function' ? selected(props.element, childrenProps) : selected
  return {
    measured: Boolean(layout && dimensions),
    children,
    element: props.element,
    onLayout: (event) => {
      setLayout(event)
      setDimensions(event.nativeEvent.layout)
    },
  }
}
export default useLayoutWrapper
