import VerifyScreenView from './VerifyScreenView'
import { VerifyScreenProps } from './screen.types'
import useVerifyScreen from './useVerifyScreen'

const VerifyScreen = (props: VerifyScreenProps) => <VerifyScreenView {...useVerifyScreen(props)} />

export default VerifyScreen
