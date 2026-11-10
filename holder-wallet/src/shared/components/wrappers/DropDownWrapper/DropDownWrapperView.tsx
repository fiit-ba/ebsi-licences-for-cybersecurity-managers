import { AntDesign } from '@expo/vector-icons'
// Uses React 19's exported element type instead of the removed global JSX namespace.
import React, { type ReactElement } from 'react'
import { View } from 'react-native'
import { Title } from '@shared/components/atomic_components/Text/variants'
import LayoutWrapper from '@shared/components/wrappers/LayoutWrapper'
import AnimatedView from '@shared/components/wrappers/DropDownWrapper/components/AnimatedView'
import DropDownWrappedStyled from '@shared/components/wrappers/DropDownWrapper/component.styles'

import { DropDownWrapperViewProps } from './component.types'

const DropDownWrapperView = ({ isExpanded, toggleExpanded, ...props }: DropDownWrapperViewProps) => {
  return (
    <DropDownWrappedStyled.Wrapper style={{ ...props.wrapperStyle }} testID={props.testID}>
      <DropDownWrappedStyled.TouchableTitle
        style={{
          ...props.style,
        }}
        onPress={toggleExpanded}
      >
        <Title style={props.titleStyle}>{props.title}</Title>
        <AntDesign name={isExpanded ? 'up' : 'down'} size={14} />
      </DropDownWrappedStyled.TouchableTitle>
      <View style={{ position: 'relative' }}>
        <DropDownWrappedStyled.ContentView style={props.contentStyled}>
          <LayoutWrapper element={props.children}>
            {/*
                Uses React 19's exported element type for the measured render callback. */}
            {(element: ReactElement, { dimensions }: any) => (
              <AnimatedView height={dimensions?.height} duration={props.duration} isExpanded={isExpanded}>
                {element}
              </AnimatedView>
            )}
          </LayoutWrapper>
        </DropDownWrappedStyled.ContentView>
      </View>
    </DropDownWrappedStyled.Wrapper>
  )
}

export default DropDownWrapperView
