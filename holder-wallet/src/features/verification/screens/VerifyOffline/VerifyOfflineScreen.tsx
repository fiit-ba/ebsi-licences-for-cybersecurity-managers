import VerifyOfflineScreenView from './VerifyOfflineScreenView'
import { VerifyOfflineScreenProps } from './screen.types'
import useVerifyOfflineScreen from './useVerifyOfflineScreen'

const VerifyOfflineScreen = (props: VerifyOfflineScreenProps) => (
  <VerifyOfflineScreenView {...useVerifyOfflineScreen(props)} />
)

export default VerifyOfflineScreen
