import CredentialsScreenView from './CredentialsScreenView'
import { CredentialsScreenProps } from './screen.types'
import useCredentialsScreen from './useCredentialsScreen'

const CredentialsScreen = (props: CredentialsScreenProps) => <CredentialsScreenView {...useCredentialsScreen(props)} />

export default CredentialsScreen
