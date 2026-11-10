import { forwardRef } from 'react'
import StateWrapperView from './StateWrapperView'
import useStateWrapper from './useStateWrapper'
import { StateWrapperProps } from './component.types'
import { StateWrapperRef } from './type'

const StateWrapper = forwardRef<StateWrapperRef, StateWrapperProps>((props, ref) => (
  <StateWrapperView {...useStateWrapper(props, ref)} />
))
export default StateWrapper
