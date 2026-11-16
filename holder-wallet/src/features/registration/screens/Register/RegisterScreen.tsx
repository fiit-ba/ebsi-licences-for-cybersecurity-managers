import RegisterScreenView from './RegisterScreenView'
import { RegisterScreenProps } from './screen.types'
import useRegisterScreen from './useRegisterScreen'

const RegisterScreen = (props: RegisterScreenProps) => <RegisterScreenView {...useRegisterScreen(props)} />

export default RegisterScreen
