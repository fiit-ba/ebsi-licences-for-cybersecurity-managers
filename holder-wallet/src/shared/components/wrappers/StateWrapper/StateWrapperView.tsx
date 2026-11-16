// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import DefaultEmptyState from '@shared/components/wrappers/StateWrapper/components/DefaultEmptyState'
import DefaultError from '@shared/components/wrappers/StateWrapper/components/DefaultError'
import { View } from '@shared/components/Themed'
import Loading from '@shared/components/Loading'
import { StateWrapperViewProps } from './component.types'
import { componentStyles } from './component.styles'

const StateWrapperView = (props: StateWrapperViewProps) => {
  return (
    <View style={[componentStyles.container, props.containerStyle]}>
      {props.status === 'loading' && <Loading height="100%" />}
      {props.status === 'completed' && props.renderData(props.data)}
      {props.status === 'error' && (props.renderError ? props.renderError(props.data) : <DefaultError />)}
      {props.status === 'empty-state' && (props.renderEmptyState ?? <DefaultEmptyState />)}
    </View>
  )
}

export default StateWrapperView
