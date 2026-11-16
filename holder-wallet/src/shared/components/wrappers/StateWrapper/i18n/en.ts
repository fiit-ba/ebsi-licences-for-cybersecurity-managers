// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@shared/components/wrappers/StateWrapper/i18n/sk'

const localeEN: typeof localeSK = {
  RELOAD_BUTTON: 'Reload',
  EMPTY_STATE_MESSAGE: 'The requested data was not found',
  ERROR_MESSAGE: 'Something went wrong, please try again later',
}

export default localeEN
