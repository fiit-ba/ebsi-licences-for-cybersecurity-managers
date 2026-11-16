import { useEffect } from 'react'
import { SCREEN } from '@shared/constants/screens'
import { SPLASH_DELAY_MS } from './screen.constants'
import { SplashScreenProps } from './screen.types'
const useSplashScreen = ({ navigation }: SplashScreenProps) => {
  useEffect(() => {
    const timer = setTimeout(() => navigation.navigate(SCREEN.OnBoarding), SPLASH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [navigation])
  return {}
}
export default useSplashScreen
