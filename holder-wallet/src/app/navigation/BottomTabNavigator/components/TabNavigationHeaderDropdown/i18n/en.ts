// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown/i18n/sk'

const localeEN: typeof localeSK = {
  DID_MANAGEMENT: 'Manage DIDs',
  NETWORK_AUTH: 'Add a new DID',
  TERMS_AND_CONDITIONS: 'Terms of use',
  BLOCK_SESION: 'Sign out',
  BUTTON_CLOSE: 'Close',
  REMOVE_USER_KEYS: 'Delete account',
  DIALOG_TITLE: 'Do you really want to delete your account?',
  DIALOG_DESCRIPTION: 'Your keys, licenses and all data you created will be permanently removed from this device',
  DIALOG_HOLDER_DESCRIPTION:
    "The license holder's wallet is permanently removed from this device: its keys, licenses and history. The organisation's profile stays.",
  DIALOG_ORG_TITLE: "Do you really want to delete the organisation's profile?",
  DIALOG_ORG_DESCRIPTION:
    "The organisation's profile is removed from this device: its PIN and history. The organisation's back-office account stays, and so does the license holder's wallet.",
  SWITCH_LANGUAGE: 'Switch to Slovak',
  SWITCH_TO_ORG: 'Switch to organisation',
  SWITCH_TO_HOLDER: 'Switch to license holder',
  OPEN_MENU: 'Open menu',
  CLOSE_MENU: 'Close menu',
}

export default localeEN
