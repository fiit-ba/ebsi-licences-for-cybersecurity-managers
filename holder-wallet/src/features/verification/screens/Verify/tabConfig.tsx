// The verifier as a tab of the signed-in wallet's bottom bar (component 6),
// next to the holder's own certificates: checking someone else's certificate
// is as much what the app is for as keeping one's own. The strings are the
// Verify bundle, registered by ./config.ts.
import i18next from '@app/localization/i18n'
import { SCREEN } from '@shared/constants/screens'
import { TabScreenConfig } from '@shared/types/navigation'
import TabBarIcon from '@shared/components/TabBarIcon'
import Verify from '@features/verification/screens/Verify'
import type { RootTabScreenProps } from '@app/navigation/types'

const VerifyTab = (props: RootTabScreenProps<'VerifyTab'>) => <Verify {...props} inTab />

const VerifyTabConfig: TabScreenConfig = {
  name: SCREEN.VerifyTab,
  component: VerifyTab,
  options: {
    // Getters: the header and the tab follow the language switch.
    get title() {
      return String(i18next.t('TITLE', { ns: SCREEN.Verify }))
    },
    get tabBarLabel() {
      return String(i18next.t('TAB', { ns: SCREEN.Verify }))
    },
    tabBarIcon: ({ focused }) => (
      <TabBarIcon focused={focused} name="shield-check-outline" selectedName="shield-check" />
    ),
  },
}

export default VerifyTabConfig
