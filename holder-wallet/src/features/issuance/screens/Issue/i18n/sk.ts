import { BRAND } from '@shared/constants/brand'

const localeSK = {
  TITLE: 'Vydať licenciu',
  TAB: 'Vydať',
  SIGN_IN_TITLE: 'Prihlásenie organizácie',
  SIGN_IN_TEXT:
    'Na vydávanie sa prihláste heslom účtu {{username}}. Prihlásenie platí 15 minút a zruší sa, keď sa peňaženka zamkne.',
  PASSWORD: 'Heslo',
  PASSWORD_PLACEHOLDER: 'Zadajte heslo organizácie',
  SIGN_IN: 'Prihlásiť sa',
  INTRO: 'Licencia sa zaregistruje v registri a držiteľ si ju vyzdvihne naskenovaním QR kódu vo svojej peňaženke.',
  HOLDER_REFERENCE: 'Interná referencia držiteľa',
  HOLDER_REFERENCE_PLACEHOLDER: 'napr. spis-2026-0001',
  HOLDER_REFERENCE_HINT:
    'Pseudonymný kľúč do vašej evidencie, napr. spis-2026-0001. Nikdy nie meno ani DID držiteľa (komponent 1.2).',
  ISSUE: 'Vydať licenciu',
  FILL_REQUIRED: 'Vyplňte povinné polia.',
  CHECK_FIELDS: 'Skontrolujte vyznačené polia.',
  ERROR_SCHEME: 'Schému licencie sa nepodarilo načítať',
  OPTIONAL: '(voliteľné)',
  KIND: 'Druh licencie',
  NO_SCHEMAS: 'Vaša organizácia zatiaľ nesmie vydávať žiadny druh licencie. Pridelí vám ho váš TAO v back-office.',
  // Until when the TI may issue (design decisions D23).
  ACCREDITED_UNTIL: 'Akreditovaná do {{date}}',
  ACCREDITATION_ENDING: 'Akreditácia vašej TI skončí {{date}} (o {{days}} dní). O predĺženie požiadajte svoj TAO.',
  ACCREDITATION_EXPIRED_TITLE: 'Akreditácia skončila',
  ACCREDITATION_EXPIRED_TEXT:
    'Akreditácia vašej TI skončila {{date}}, preto už nemôžete vydávať nové licencie. Licencie, ktoré ste vydali počas akreditácie, zostávajú platné do konca svojej platnosti. O obnovenie požiadajte svoj TAO.',
  DATE_PLACEHOLDER: 'Vyberte dátum',
  DATE_CANCEL: 'Zrušiť',
  DATE_CONFIRM: 'Potvrdiť',
  DATE_CLEAR: 'Vymazať',
  // The certificate scheme (the back-office's back-office/server/issuance/schemes.ts)
  DETAILS: 'Údaje licencie',
  READY_TITLE: 'Licencia je pripravená na vyzdvihnutie',
  READY_TEXT: `Držiteľ naskenuje tento QR kód v aplikácii ${BRAND.NAME} tlačidlom Skenovať a zadá PIN. PIN mu povedzte zvlášť: samotný QR kód nestačí.`,
  PIN: 'PIN pre držiteľa',
  VALID_UNTIL: 'Ponuka platí do {{time}}.',
  SHARE: 'Zdieľať odkaz',
  SHARE_MESSAGE: `Ponuka licencie pre aplikáciu ${BRAND.NAME}; PIN dostanete zvlášť: {{uri}}`,
  ANOTHER: 'Vydať ďalšiu licenciu',
  QR_LABEL: 'QR kód s ponukou licencie',
  ERROR: 'Licenciu sa nepodarilo vydať',
}

export default localeSK
