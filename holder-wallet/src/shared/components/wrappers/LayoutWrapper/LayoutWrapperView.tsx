// Uses React 19's exported element type throughout this render-prop wrapper.
import React from 'react'
import { View } from 'react-native'
import { LayoutWrapperViewProps } from './component.types'
import { componentStyles } from './component.styles'

/*
  This component is a wrapper used to get information about the layout and dimensions of a React Native component. This is useful for making styling changes to components based on their position on the screen or the size of the user's screen.

  LayoutWrapper accepts the following props:

  childrenProps: An object or a function that returns an object that is passed as props to child components.
  element – The React Native component that is wrapped with the LayoutWrapper.
  children: The child components to render within the LayoutWrapper.
*/

const LayoutWrapperView = ({ measured, children, element, onLayout }: LayoutWrapperViewProps) => {
  return (
    <View>
      {measured && React.cloneElement(children)}
      {!measured &&
        React.cloneElement(<View>{element}</View>, {
          style: componentStyles.measurement,
          onLayout,
        })}
    </View>
  )
}

export default LayoutWrapperView
