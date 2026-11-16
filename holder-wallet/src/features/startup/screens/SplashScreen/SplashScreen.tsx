import SplashScreenView from './SplashScreenView'
import useSplashScreen from './useSplashScreen'
import { SplashScreenProps } from './screen.types'
const SplashScreen = (props: SplashScreenProps) => {
  useSplashScreen(props)
  return <SplashScreenView />
}
export default SplashScreen
