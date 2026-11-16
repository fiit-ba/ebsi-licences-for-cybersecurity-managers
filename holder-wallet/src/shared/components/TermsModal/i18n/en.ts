// English locale, for the language switch (src/constants/i18n.ts). The keys
// follow ./sk.ts, the default; the type below makes a missing one an error.
import localeSK from '@shared/components/TermsModal/i18n/sk'

const localeEN: typeof localeSK = {
  MODAL_TITLE: 'Terms of use',
  CHECKBOX: 'I agree to the terms of use',
  MODAL_BUTTON: 'I agree',
  TERMS_AND_CONDITIONS_CONTENT: `**The terms of use have not been supplied yet.**

This wallet is a pilot deployment of the register of licenses of professional competence. Before going live, the pilot operator must add its own terms of use and its information on the processing of personal data under Regulation (EU) 2016/679 and Slovak Act No. 18/2018 Coll.

The terms must state in particular:

· the operator (the certification body), including the contact of its data protection officer,

· the legal basis and purpose of processing personal data,

· how long data is kept and to whom it is disclosed,

· the data subject's rights and how to exercise them,

· the governing law and the competent court.`,
}

export default localeEN
