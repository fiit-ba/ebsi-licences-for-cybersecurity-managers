import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import SplashScreen from '@features/startup/screens/SplashScreen'

const ScreenName = SCREEN.SplashScreen

const SplashScreenConfig: navigationScreensConfigType = {
  name: ScreenName,
  component: SplashScreen,
  options: { headerShown: false },
}

export default SplashScreenConfig
