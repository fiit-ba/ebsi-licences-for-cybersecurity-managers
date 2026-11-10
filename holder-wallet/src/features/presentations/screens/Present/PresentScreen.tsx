import PresentScreenView from './PresentScreenView'
import { PresentScreenProps } from './screen.types'
import usePresentScreen from './usePresentScreen'

const PresentScreen = (props: PresentScreenProps) => <PresentScreenView {...usePresentScreen(props)} />

export default PresentScreen
