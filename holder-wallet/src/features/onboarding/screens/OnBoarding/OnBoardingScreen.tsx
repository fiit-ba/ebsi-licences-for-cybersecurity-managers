import OnBoardingHeader from './components/OnBoardingHeader'
import OnBoardingScreenView from './OnBoardingScreenView'
import useOnBoardingScreen from './useOnBoardingScreen'
import { OnBoardingScreenProps } from './screen.types'
const OnBoardingScreen = (props: OnBoardingScreenProps) => (
  <OnBoardingScreenView {...useOnBoardingScreen(props)} header={<OnBoardingHeader navigation={props.navigation} />} />
)
export default OnBoardingScreen
