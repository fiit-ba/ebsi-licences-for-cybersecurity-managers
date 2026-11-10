// Its strings are the verifier's (features/verification/screens/Verify), registered there.
import { SCREEN } from '@shared/constants/screens'
import { navigationScreensConfigType } from '@shared/types/navigation'
import VerifyOffline from '@features/verification/screens/VerifyOffline'

const VerifyOfflineConfig: navigationScreensConfigType = {
  name: SCREEN.VerifyOffline,
  component: VerifyOffline,
  options: { headerShown: true },
}

export default VerifyOfflineConfig
