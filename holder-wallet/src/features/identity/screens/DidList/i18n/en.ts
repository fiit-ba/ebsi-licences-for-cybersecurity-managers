// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/identity/screens/DidList/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'My identities',
  CARD_DESCRIPTION: 'DID registered on {{network}} ({{entity}})',
  PRESS_TO_COPY: 'Press and hold the DID to copy it',
  ADD_NEW_DID: 'Add a DID',
  NO_DID_CREATED: 'You have not created a DID yet. Add one with the button below.',
  // The wallet's DID stays on the phone (design decisions D34).
  WALLET_DID_HINT: "Your wallet's DID stays on this phone and is sent to no one.",
}

export default localeEN
