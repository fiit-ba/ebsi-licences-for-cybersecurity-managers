import localeSK from '@features/recovery/screens/Restore/i18n/sk'

const localeEN: typeof localeSK = {
  TITLE: 'Restore your wallet',
  SUBTITLE:
    'Enter the 12 words of your security phrase in the order you wrote them down. The wallet gets back its identity and its licenses from the backup.',
  PHRASE: 'Security phrase',
  WORD_COUNT: '{{count}} of 12 words',
  UNKNOWN_WORDS: 'These words are not in the list: {{words}}',
  INVALID_PHRASE: 'The phrase is not valid. Check the order and the spelling of the words.',
  PIN: 'New access PIN',
  SECOND_PIN: 'Repeat the PIN',
  ERROR_PIN_LENGTH: 'The PIN must have at least 4 digits',
  ERROR_PIN_MATCH: 'The PINs do not match',
  BUTTON: 'Restore wallet',
  LOADING: 'Restoring…',
  REPLACE_TITLE: 'Replace the wallet?',
  REPLACE_TEXT: 'The restored wallet replaces the one on this phone now, licenses included.',
  REPLACE_CONFIRM: 'Replace',
  CANCEL: 'Cancel',
  RESTORED: 'The wallet is restored. Licenses from the backup: {{count}}',
  RESTORED_NO_BACKUP: 'The wallet is restored. No backup of its licenses was found.',
  UNAVAILABLE:
    "We can't restore your wallet right now. Our services are temporarily unavailable for maintenance. Please try again in a little while.",
  OFFLINE:
    "We can't restore your wallet right now: the phone is not connected to the internet. Connect it and try again.",
  ERROR: 'The wallet could not be restored.',
  GO_BACK: 'Back',
}

export default localeEN
