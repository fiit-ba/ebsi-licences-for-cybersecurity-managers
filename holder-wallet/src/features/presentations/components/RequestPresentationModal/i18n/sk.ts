const localeSK = {
  TITLE: 'Predložiť licencie',
  DESCRIPTION:
    'Bolo vyžiadané povolenie predložiť overiteľné údaje z vašich licencií. Nižšie si vyberiete, ktoré licencie chcete predložiť; overovateľ získa prístup len k údajom, ktoré mu poskytnete. Prístup k predloženým údajom môžete kedykoľvek odvolať v zozname prezentácií.',
  SELECT_CREDENTIAL_DESCRIPTION:
    'Vyberte požadovaný počet licencií. Počítadlo ukazuje, koľko z nich ešte treba vybrať:',
  SELECTED_COUNT: 'Vybrané: {{selected}} z {{required}}',
  REQUEST_CONTINUE: 'Pokračovať',
  REQUEST: 'Zdieľať',
  CREDENTIALS_EMPTY_STATE: 'Nemáte uloženú žiadnu licenciu. Pre pokračovanie najprv pridajte licenciu.',
  GO_BACK: 'Späť',
  VALID_FROM: 'Platná od',
  ORGANIZATION: 'Organizácia',
  TYPE: 'Typ',
  EXPIRATION_DATE: 'Platnosť do',
  NEVER: 'Nikdy',
  // Additions (project documentation, "Tested on a phone")
  ALL: 'Všetky',
  NUMBER: 'Číslo',
  // Availability in the selection list
  SELECT_ONE: 'Vyberte licenciu, ktorú chcete predložiť:',
  CHECKING: 'Overuje sa aktuálny stav licencií…',
  NONE_USABLE: 'Žiadnu z vašich licencií teraz nemožno predložiť.',
  STATUS_SUSPENDED: 'Pozastavená — nemožno predložiť',
  STATUS_REVOKED: 'Odňatá — nemožno predložiť',
  STATUS_EXPIRED: 'Platnosť uplynula {{date}} — nemožno predložiť',
  STATUS_NOT_YET: 'Platná až od {{date}} — zatiaľ nemožno predložiť',
  STATUS_UNVERIFIED: 'Aktuálny stav sa nepodarilo overiť — rozhodne overovateľ',
  // What of each certificate is shared (design decisions D36)
  FIELDS_DESCRIPTION:
    'Vyberte, ktoré údaje z licencie zdieľate. Overovateľ ponúka tieto možnosti a uvidí len údaje tej, ktorú zvolíte.',
  FIELDS_ALWAYS:
    'Vždy sa zdieľa číslo licencie, vydavateľ, schéma, platnosť a odkaz na register certifikátov - podľa nich overovateľ licenciu overí.',
  OPTION_ALL: 'Všetky požadované údaje ({{count}})',
  OPTION_REQUIRED: 'Len nevyhnutné údaje ({{count}})',
  OPTION_OTHER: 'Možnosť {{number}} ({{count}} údajov)',
  FIELDS_COUNT: 'Zdieľate {{count}} z {{total}} údajov.',
}

export default localeSK
