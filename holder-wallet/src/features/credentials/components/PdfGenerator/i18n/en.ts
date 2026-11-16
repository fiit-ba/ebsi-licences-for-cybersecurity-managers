// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@features/credentials/components/PdfGenerator/i18n/sk'

const localeEN: typeof localeSK = {
  DIALOG_TITLE: 'Generate PDF',
  DIALOG_DESCRIPTION: 'Do you want to generate the license as a PDF and share it?',
  BUTTON_CANCEL: 'Cancel',
  BUTTON_CONFIRM: 'Confirm',
  BUTTON_GENERATE: 'Generate PDF',
}

export default localeEN
