const localeSK = {
  TITLE: 'Organizácia',
  INTRO:
    'Certifikačné orgány (TI) vydávajú licencie priamo z aplikácie. Organizáciu musí najprv vybrať TAO a dať jej pozvánku; s ňou sa tu zaregistrujete a potom prihlasujete.',
  TAB_SIGN_IN: 'Prihlásiť sa',
  TAB_REGISTER: 'Registrovať',
  USERNAME: 'Používateľské meno',
  PASSWORD: 'Heslo',
  PASSWORD_AGAIN: 'Zopakujte heslo',
  INVITATION: 'Pozvánka od TAO',
  SIGN_IN: 'Prihlásiť sa',
  SIGN_IN_HINT:
    'Potom si zvolíte PIN profilu organizácie. Profil organizácie je samostatný: má vlastný PIN, nepotrebuje bezpečnostnú frázu a peňaženky držiteľa licencií sa nedotkne.',
  // The organization's own PIN (design decisions D18)
  PIN_TITLE: 'PIN profilu organizácie',
  PIN_TEXT:
    'Prihlásené ako {{username}}. Zvoľte PIN, ktorým budete odomykať profil organizácie v tomto zariadení. Môže sa líšiť od PIN-u držiteľa licencií.',
  PIN: 'PIN organizácie',
  PIN_AGAIN: 'Zopakujte PIN',
  CREATE_PROFILE: 'Vytvoriť profil',
  PIN_HINT:
    'Profil organizácie a peňaženka držiteľa licencií sú nezávislé: zmazaním jedného zostane druhý. Heslo účtu v back-office sa v zariadení neukladá.',
  PIN_SHORT: 'PIN musí mať aspoň 4 číslice.',
  PINS_DIFFER: 'PIN-y sa nezhodujú.',
  REGISTER: 'Registrovať a prihlásiť sa',
  REGISTER_HINT:
    'Pozvánku dostane organizácia od TAO, ktorý ju vybral za TI. Platí raz; ak vypršala, požiadajte TAO o novú.',
  FILL_ALL: 'Vyplňte všetky polia.',
  PASSWORDS_DIFFER: 'Heslá sa nezhodujú.',
  NOT_CONFIGURED: 'Aplikácia nemá nastavenú adresu registra.',

  // What the registry refused, in words an organization can act on
  ERROR_CREDENTIALS: 'Nesprávne meno alebo heslo.',
  ERROR_NOT_ISSUER: 'Tento účet nemá oprávnenie vydávať licencie. TAO a RootTAO pracujú v back-office konzole.',
  ERROR_USERNAME_TAKEN: 'Toto používateľské meno je už obsadené.',
  ERROR_WEAK_PASSWORD: 'Heslo nie je dosť silné.',
  ERROR_INVALID_FIELDS: 'Skontrolujte: {{fields}}.',
  ERROR_INVALID_INVITATION:
    'Pozvánka neplatí: je nesprávna, už použitá alebo vypršala. O novú požiadajte TAO, ktorý vás vybral.',
  ERROR_WRONG_KIND: 'Táto pozvánka je pre TAO. TAO sa registruje v back-office konzole, nie v aplikácii.',
  ERROR_NOT_TI: 'Vydávať môže len TI, ktorú vybral TAO. Tento účet nie je TI v reťazci dôvery.',
  ERROR_SCHEMA_NOT_ACCREDITED: 'Vaša TI nie je akreditovaná na vydávanie tohto druhu licencie. Pridelí vám ho váš TAO.',
  ERROR_INVALID_CLAIMS: 'Licencia nezodpovedá schéme. Skontrolujte vyznačené polia.',
  ERROR_TOO_MANY: 'Priveľa pokusov z tejto siete. Skúste to neskôr.',
  ERROR_SIGNED_OUT: 'Prihlásenie organizácie vypršalo. Prihláste sa znova.',
  ERROR_NOT_ACCREDITED: 'Register teraz nemôže vydávať: akreditácia vydavateľa nie je potvrdená.',
  // The TI issues under its own DID (design decisions D27).
  ERROR_NOT_ONBOARDED:
    'Vaša TI ešte nie je v EBSI nastavená ako vydavateľ s vlastným DID. Skúste to neskôr alebo kontaktujte prevádzkovateľa registra.',
  // A TI's accreditation has an end (design decisions D23).
  ERROR_ACCREDITATION_EXPIRED:
    'Akreditácia vašej TI skončila {{date}}. Nové licencie už vydávať nemôžete; licencie vydané počas akreditácie zostávajú platné do konca svojej platnosti. O obnovenie požiadajte svoj TAO.',
  ERROR_ACCREDITATION_EXPIRED_UNDATED:
    'Akreditácia vašej TI skončila. Nové licencie už vydávať nemôžete; licencie vydané počas akreditácie zostávajú platné do konca svojej platnosti. O obnovenie požiadajte svoj TAO.',
  // Its accreditation was revoked (D24): its own, or its TAO's
  ERROR_ACCREDITATION_REVOKED:
    'Akreditácia vašej TI bola odňatá {{date}}. Prihlásiť sa už nemôžete a licencie, ktoré ste vydali, boli stiahnuté.',
  ERROR_ACCREDITATION_REVOKED_TAO:
    'Akreditácia TAO, ktorý vašu TI vybral, bola odňatá {{date}} a s ňou aj oprávnenie vašej TI. Prihlásiť sa už nemôžete a licencie, ktoré ste vydali, boli stiahnuté.',
  ACCREDITED_UNTIL: 'Akreditácia TI platí do {{date}}.',
  ACCREDITATION_ENDED:
    'Akreditácia TI skončila {{date}} — v aplikácii môžete overovať a prezerať históriu, vydávať nie.',
  ACCREDITATION_ENDED_UNDATED:
    'Akreditácia TI skončila — v aplikácii môžete overovať a prezerať históriu, vydávať nie.',
  ERROR_ISSUE_INVALID: 'Register údaje licencie odmietol. Skontrolujte ich.',
  PASSWORD_password_too_short: 'Heslo musí mať aspoň 15 znakov.',
  PASSWORD_password_too_long: 'Heslo môže mať najviac 128 znakov.',
  PASSWORD_password_too_weak: 'Použite menej predvídateľné heslo alebo dlhšiu frázu z nesúvisiacich slov.',
  FIELD_invitation: 'pozvánka',
  FIELD_username: 'používateľské meno',
  FIELD_password: 'heslo',
}

export default localeSK
