import LoginScreenView from './LoginScreenView'
import { LoginScreenProps } from './screen.types'
import useLoginScreen from './useLoginScreen'

const LoginScreen = (props: LoginScreenProps) => <LoginScreenView {...useLoginScreen(props)} />

export default LoginScreen
