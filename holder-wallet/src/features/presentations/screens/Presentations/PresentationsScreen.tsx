import PresentationsScreenView from './PresentationsScreenView'
import { PresentationsScreenProps } from './screen.types'
import usePresentationsScreen from './usePresentationsScreen'

const PresentationsScreen = (props: PresentationsScreenProps) => (
  <PresentationsScreenView {...usePresentationsScreen(props)} />
)

export default PresentationsScreen
