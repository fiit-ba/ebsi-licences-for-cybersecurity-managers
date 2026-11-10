import { BRAND } from '@shared/constants/brand'

const localeSK = {
  TITLE: 'Overiť licenciu',
  // The tab in the bottom bar (./tabConfig.tsx)
  TAB: 'Overiť',
  INTRO: `Požiadajte držiteľa, aby tento QR kód naskenoval vo svojej aplikácii ${BRAND.NAME} tlačidlom Skenovať na karte Licencie a predloženie potvrdil.`,
  CONNECTING: 'Pripája sa k overovacej službe…',
  WAITING: 'Čaká sa na držiteľa…',
  REQUEST_UNTIL: 'Žiadosť platí do {{time}}.',
  EXPIRED: 'Žiadosť vypršala bez odpovede. Vytvorte novú.',
  DECLINED: 'Držiteľ žiadosť vo svojej peňaženke odmietol.',
  NEW_REQUEST: 'Nová žiadosť',
  VERIFY_ANOTHER: 'Overiť ďalšiu licenciu',
  RETRY: 'Skúsiť znova',
  QR_LABEL: 'QR kód so žiadosťou o predloženie',
  NOT_CONFIGURED: 'Overovanie nie je v tejto verzii aplikácie nastavené: chýba adresa overovacej služby.',
  ERROR_REQUEST: 'Žiadosť o predloženie sa nepodarilo vytvoriť',
  ERROR_RESULT: 'Výsledok overenia sa nepodarilo načítať',
  RECORDED: 'Overenie je zapísané v histórii.',
  NOT_RECORDED: 'Overenie sa nepodarilo zapísať do histórie.',
  NOT_RECORDED_GUEST: 'Bez prihlásenia do peňaženky sa overenie nikam neukladá.',

  // Verifying without the server: the holder's QR code (design decisions D33)
  OFFLINE_SCAN: 'Naskenovať QR kód držiteľa',
  OFFLINE_HINT:
    'Bez servera: držiteľ ťukne na karte Licencie na Preukázať sa a ukáže QR kód. Telefóny sa spoja priamo cez Wi-Fi a licencia sa overí v registroch EBSI a v kontrakte.',
  OFFLINE_TITLE: 'Overenie bez servera',
  OFFLINE_VERIFIER_NAME: 'Overovateľ s aplikáciou {{brand}}',
  OFFLINE_ASKING: 'Žiada sa o licenciu…',
  OFFLINE_WAITING: 'Čaká sa na súhlas držiteľa…',
  OFFLINE_CHECKING: 'Overuje sa v registroch EBSI a v kontrakte…',
  OFFLINE_DECLINED: 'Držiteľ zdieľanie odmietol.',
  OFFLINE_EXPIRED: 'Výmena skončila bez odpovede. Požiadajte držiteľa o nový QR kód.',
  OFFLINE_FAILED:
    'Telefón držiteľa sa nepodarilo kontaktovať. Oba telefóny musia byť v tej istej sieti Wi-Fi a QR kód držiteľa platí len 2 minúty.',
  OFFLINE_NOT_CONFIGURED:
    'Overenie bez servera nie je v tejto verzii nastavené: chýba adresa registrov EBSI alebo kontraktu.',
  OFFLINE_INVALID_QR: 'Tento QR kód nie je pozvánka na preukázanie licencie.',
  OFFLINE_MISSING_FIELDS: 'Chýbajú povinné údaje: {{fields}}',
  OFFLINE_SCAN_AGAIN: 'Naskenovať ďalší QR kód',

  // The answer
  CERTIFICATE_N: 'Licencia {{n}} z {{count}}',
  PRESENTED_DATA: 'Predložené údaje',
  ATTRIBUTES_UNTIL: 'Údaje sa zobrazujú do {{time}}, potom sa zmažú (komponent 1.2).',
  ATTRIBUTES_BAD_SIGNATURE: 'Nezobrazujú sa — podpis neplatí, údaje nemožno pripísať vydavateľovi.',
  ATTRIBUTES_NOT_HOLDER: 'Nezobrazujú sa — licenciu nepredložil jej držiteľ.',
  ATTRIBUTES_GONE: 'Už sa nezobrazujú — uchovávajú sa len krátko po overení (komponent 1.2).',
  ATTRIBUTES_NOT_REACHED: 'Nezobrazujú sa — overenie sa k nim nedostalo.',
  VALID_FROM: 'Platná od',
  VALID_UNTIL: 'Platná do',
  ISSUER: 'Vydavateľ',
  // The TI that issued it, judged at issuance (design decisions D23).
  CERTIFICATION_BODY: 'Certifikačný orgán (TI)',
  ACCREDITED_AT_ISSUANCE: 'Akreditácia TI pri vydaní',
  ACCREDITED_AT_ISSUANCE_YES: 'platila — licenciu vydal akreditovaný orgán',
  ACCREDITED_AT_ISSUANCE_NO: 'neplatila',
  ACCREDITED_AT_ISSUANCE_UNKNOWN: 'nezistený (licencia vydaná pred evidenciou TI)',
  ACCREDITATION_ENDED_SINCE:
    'Akreditácia TI odvtedy skončila ({{date}}); licencie vydané počas nej platia do konca svojej platnosti.',
  // Revoked since (D24): the certificate is withdrawn
  ACCREDITATION_REVOKED: 'Akreditácia tohto TI bola odňatá {{date}} — licencie, ktoré vydal, sú stiahnuté.',
  ACCREDITATION_REVOKED_TAO:
    'Akreditácia TAO {{organization}}, ktorý tento TI vybral, bola odňatá {{date}} — licencie, ktoré TI vydal, sú stiahnuté.',
  VERIFIED_AT: 'Overené',
  SHOW_DETAILS: 'Zobraziť podrobnosti overenia',
  HIDE_DETAILS: 'Skryť podrobnosti overenia',
  CONDITIONS: 'Podmienky platnosti (6.3)',
  CONDITIONS_HINT: 'Výsledok je VALID, len ak platia všetky; „—“ znamená, že sa overenie k podmienke nedostalo.',
  TRUST_CHAIN: 'Akreditačný reťazec (TIR)',
  ROLE_TI: 'TI (vydavateľ)',
  ROLE_ROOT: 'dôveryhodný koreň',
  LEDGER: 'Záznam v kontrakte riadenia',
  LEDGER_STANDING: 'Stav',
  LEDGER_NUMBER: 'Číslo licencie',
  LEDGER_REGISTERED: 'Zapísaný',
  LEDGER_CHANGED: 'Naposledy zmenený',
  LEDGER_CONTRACT: 'Kontrakt',
  STANDING_valid: 'platná',
  STANDING_suspended: 'pozastavená',
  STANDING_revoked: 'odňatá',
  STANDING_none: 'bez záznamu',
  NOT_EVALUATED: 'Nevyhodnotené — overenie sa zastavilo skôr.',

  // The output states of component 6: a short name and what it tells the verifier
  STATE_VALID: 'Platná',
  STATE_VALID_TEXT: 'Licencia je platná: všetky podmienky 6.3 sú splnené.',
  // Suspended and revoked alike, as the contract's record says (D30)
  STATE_INVALID: 'Neplatná',
  STATE_INVALID_TEXT: 'Licencia nie je platná: vydavateľ ju pozastavil alebo odňal (záznam v kontrakte).',
  STATE_SUSPENDED: 'Pozastavená',
  STATE_SUSPENDED_TEXT: 'Licencia je pozastavená. Pozastavenie je vratné, no kým trvá, licencia neplatí.',
  STATE_REVOKED: 'Odňatá',
  STATE_REVOKED_TEXT: 'Licencia bola odňatá. Odňatie je trvalé.',
  STATE_EXPIRED: 'Platnosť uplynula',
  STATE_EXPIRED_TEXT: 'Platnosť licencie uplynula (validUntil).',
  STATE_NOT_YET_VALID: 'Ešte neplatí',
  STATE_NOT_YET_VALID_TEXT: 'Licencia ešte nenadobudla platnosť (validFrom).',
  STATE_UNTRUSTED_ISSUER: 'Nedôveryhodný vydavateľ',
  STATE_UNTRUSTED_ISSUER_TEXT:
    'Vydavateľ nie je dôveryhodný: chýba alebo neplatí akreditačný reťazec v TIR, alebo certifikačný orgán nebol pri vydaní akreditovaný.',
  STATE_INVALID_SIGNATURE: 'Neplatný podpis',
  STATE_INVALID_SIGNATURE_TEXT: 'Podpis licencie nie je platný alebo kľúč nepatrí vydavateľovi.',
  STATE_STATUS_UNAVAILABLE: 'Stav nedostupný',
  STATE_STATUS_UNAVAILABLE_TEXT:
    'Stav sa nedá s istotou určiť: záznam licencie v kontrakte je nedostupný alebo ešte nie je zapísaný. Nikdy to neznamená „platná“.',
  STATE_INDETERMINATE: 'Nerozhodnuté',
  STATE_INDETERMINATE_TEXT: 'Overenie nemožno dokončiť. Výsledok nie je „platná“.',

  // Component 6.3, condition by condition, in the specification's words
  COND_presentation_valid: 'VP je platná (nonce, audience, ochrana proti replay)',
  COND_signature_valid: 'podpis VC je platný',
  COND_issuer_key_valid: 'issuer DID je rozlíšiteľný a kľúč platný',
  COND_issuer_accredited: 'akreditácia issuera je platná pre daný typ credentialu',
  COND_schemas_valid: 'credential zodpovedá obom schémam',
  COND_time_valid: 'časová platnosť VC je splnená',
  COND_holder_bound: 'holder binding je overený',
  COND_disclosures_valid: 'zdieľané údaje zodpovedajú tomu, čo vydavateľ podpísal',
  COND_status_available: 'záznam licencie v kontrakte je dostupný',
  COND_record_matches: 'záznam v kontrakte patrí tejto licencii (TI, číslo, id, platnosť)',
  COND_standing_valid: 'kontrakt vedie licenciu ako platnú',
}

export default localeSK
