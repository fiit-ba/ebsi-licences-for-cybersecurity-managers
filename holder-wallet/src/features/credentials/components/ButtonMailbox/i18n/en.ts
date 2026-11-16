// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/credentials/components/ButtonMailbox/i18n/sk'

const localeEN: typeof localeSK = {
  BUTTON_MAILBOX: 'Refresh licenses',
  BUTTON_MAILBOX_SUCCESS: 'The license list has been refreshed',
  BUTTON_MAILBOX_INCOMPLETE: 'The status of some licenses could not be checked now. The last known status is shown.',
}

export default localeEN
