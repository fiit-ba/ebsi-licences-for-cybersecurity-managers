import RestoreScreenView from './RestoreScreenView'
import { RestoreScreenProps } from './screen.types'
import useRestoreScreen from './useRestoreScreen'

const RestoreScreen = (props: RestoreScreenProps) => <RestoreScreenView {...useRestoreScreen(props)} />

export default RestoreScreen
