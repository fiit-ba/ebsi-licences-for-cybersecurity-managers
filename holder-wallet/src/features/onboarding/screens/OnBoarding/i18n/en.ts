// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import { BRAND } from '@shared/constants/brand'
import localeSK from '@features/onboarding/screens/OnBoarding/i18n/sk'

const localeEN: typeof localeSK = {
  LINK_HEADER: 'More information',
  FIRST_SCREEN_TITLE: BRAND.NAME,
  FIRST_SCREEN_SUBTITLE: 'The app that keeps your credentials safe on your phone.',
  SECOND_SCREEN_TITLE: 'Store or share data',
  SECOND_SCREEN_SUBTITLE:
    'Scan a QR code to store licenses issued by trusted organisations. Do the same when an organisation asks you for data - you decide what it gets to see.',
  THIRD_SCREEN_TITLE: 'Revoke access',
  THIRD_SCREEN_SUBTITLE:
    'When you no longer want to share data with an organisation, revoke its access in the list of presentations. You find it in the bottom navigation.',
  FOURTH_SCREEN_TITLE: 'Verify a license',
  FOURTH_SCREEN_SUBTITLE:
    "Verify someone else's license, even without registering: show a QR code, the holder scans it in their app, and you see at once whether it is valid.",
  SKIP: 'Skip',
  BUTTON: 'Get started',
}

export default localeEN
