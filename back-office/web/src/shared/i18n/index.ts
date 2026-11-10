// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

// The console's languages: Slovak, the default, and English, since the
// registry is meant to be international later.
//
// The Slovak text is the key (t('Vydať certifikát')), so the source reads as
// the page does and a string without a translation still shows in Slovak.
// English lives in i18n/en.js. The active language is reactive in React and is
// also readable by non-component helpers, so switching language does not reload
// the whole console.
import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.ts';

export const LANGS = ['sk', 'en'];
export const LANG_NAMES = { sk: 'Slovenčina', en: 'English' };
const KEY = 'plr.lang';
const DEFAULT_LANG = 'sk';

/**
 * Read a supported language from browser storage using the existing fallback behavior.
 * @returns The stored supported language, or an empty string.
 */
function remembered() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Storage blocked: the default.
  }
  return '';
}

/**
 * Read a supported language from the current URL using the existing fallback behavior.
 * @returns The URL language when supported, otherwise an empty string.
 */
function asked() {
  try {
    const next = new URL(window.location.href).searchParams.get('lang');
    return LANGS.includes(next) ? next : '';
  } catch {
    return '';
  }
}

/**
 * Select the initial value using the existing configuration and fallback order.
 * @returns The initial configured value or existing fallback.
 */
function initial() {
  return asked() || remembered() || DEFAULT_LANG;
}

/**
 * Persist the selected value through the existing storage or submission path.
 * @param next - Selected console language.
 * @returns No return value; the existing operation updates its owned state or storage.
 */
function save(next) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not remembered, but still applied for this session.
  }
}

/**
 * Resolve the existing Slovak or English browser locale for a console language.
 * @param code - Existing role, language or refusal code selected by the caller.
 * @returns The existing sk-SK or en-GB locale.
 */
function localeFor(code) {
  return code === 'en' ? 'en-GB' : 'sk-SK';
}

/**
 * Apply the selected language to the document when a browser document is available.
 * @param next - Selected console language.
 * @returns No return value; the existing operation updates its owned state or storage.
 */
function setDocumentLang(next) {
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

let activeLang = initial();
save(activeLang);
setDocumentLang(activeLang);

const listeners = new Set<(language: string) => void>();

/**
 * Read the active console language used by components and non-component helpers.
 * @returns The current console language.
 */
export function getLang() {
  return activeLang;
}

/**
 * Read the existing browser locale for the active console language.
 * @returns The active browser locale.
 */
export function getLocale() {
  return localeFor(activeLang);
}

const fill = (text, params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match) : text;

/**
 * The text in the active language; params fill {0}, {1}, … or {name}.
 * @param text - Text to normalize or translate.
 * @param params - Existing query parameters or translation placeholders.
 * @returns The selected-language text with the supplied placeholders filled.
 */
export function t(text: string, params?: readonly unknown[] | Record<string, unknown>): string {
  return fill(activeLang === 'en' ? (en[text] ?? text) : text, params);
}

/**
 * A date and time in the active language; "—" when there is none.
 * @param value - Current input or state value.
 * @returns The locale-formatted date and time, or an em dash for an absent value.
 */
export const formatDateTime = (value) =>
  value || value === 0 ? new Date(value).toLocaleString(getLocale()) : '—';

/**
 * A date in the active language; "—" when there is none.
 * @param value - Current input or state value.
 * @returns The locale-formatted date, or an em dash for an absent value.
 */
export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(getLocale()) : '—';

/**
 * Apply a supported language, persist it when possible and notify the existing subscribers.
 * @param next - Selected console language.
 * @returns The active supported language after the attempted change.
 */
export function setLang(next) {
  if (!LANGS.includes(next) || next === activeLang) return activeLang;
  activeLang = next;
  save(next);
  setDocumentLang(next);
  for (const listener of listeners) listener(next);
  return activeLang;
}

const I18nContext = createContext(null);

/**
 * Provide the existing reactive language, translation and formatting operations.
 * @param options - Existing component inputs: {children}.
 * @returns The rendered React content.
 */
export function I18nProvider(options) {
  const { children } = options;

  const [current, setCurrent] = useState(activeLang);

  useEffect(() => {
    const listener = (next) => setCurrent(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({
      lang: current,
      locale: localeFor(current),
      setLang,
      t,
      formatDate,
      formatDateTime,
    }),
    [current],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

/**
 * Read the existing language context or its non-provider fallback.
 * @returns The active language, locale, setter, translator and date formatters.
 */
export function useI18n() {
  const context = useContext(I18nContext);
  if (context) return context;
  return {
    lang: activeLang,
    locale: localeFor(activeLang),
    setLang,
    t,
    formatDate,
    formatDateTime,
  };
}

/* ------------------------------------------------------------------------ */
/* Messages from the back-office and the verifier                            */
/* ------------------------------------------------------------------------ */

// The back-office answers in English. In Slovak each known message is
// rewritten, its variable parts (DIDs, key ids, numbers) kept; an unknown one
// is shown under a Slovak heading rather than as a bare English sentence.
const SERVER: [RegExp, string][] = [
  // Sign-in and operator permissions.
  [/^No active account found with the given credentials\.?$/i, 'Nesprávne meno alebo heslo.'],
  [/^Use at least 15 characters\.$/, 'Použite aspoň 15 znakov.'],
  [/^Use at most 128 characters\.$/, 'Použite najviac 128 znakov.'],
  [
    /^Choose a less predictable password or a longer phrase with unrelated words\.$/,
    'Vyberte menej predvídateľné heslo alebo dlhšiu frázu z nesúvisiacich slov.',
  ],
  [/^Authentication credentials were not provided\.?$/i, 'Nie ste prihlásený. Prihláste sa.'],
  [/^You do not have permission to perform this action\.?$/i, 'Na tento úkon nemáte oprávnenie.'],
  [/^Not found\.?$/i, 'Záznam sa nenašiel.'],
  [/^Method "?(\w+)"? not allowed\.?$/i, 'Metóda {1} nie je povolená.'],
  [/^This field is required\.?$/i, 'Toto pole je povinné.'],
  [/^This field may not be blank\.?$/i, 'Toto pole nesmie byť prázdne.'],
  [/^Enter a valid date\/time\.?$/i, 'Zadajte platný dátum a čas.'],
  [/^Datetime has wrong format\..*$/i, 'Dátum a čas majú nesprávny formát.'],
  [/^Given token not valid for any token type$/i, 'Relácia vypršala. Prihláste sa znova.'],
  [/^Token is invalid or expired$/i, 'Relácia vypršala. Prihláste sa znova.'],
  // Registry roles and governance (back-office/server/lifecycle/console-governance.ts).
  [/^This needs one of these roles: (.+)\.$/, 'Na tento úkon potrebujete jednu z rolí: {1}.'],
  [
    /^You have not been assigned role (\S+) \(group (\S+)\)\.$/,
    'Nemáte pridelenú rolu {1} (skupina {2}).',
  ],
  [/^Role (\S+) cannot be used from this console\.$/, 'Rolu {1} z tejto konzoly nemožno použiť.'],
  [
    /^You have already put one of the body's signatures on this change\.$/,
    'Na túto zmenu ste už za certifikačný orgán jeden podpis dali.',
  ],
  [/^No governance contract is configured\.$/, 'Nie je nakonfigurovaný žiadny kontrakt riadenia.'],
  [/^Unknown proposal$/, 'Neznámy návrh.'],
  // The trust chain and the certificate scheme (design decisions D15, D16).
  [/^Only a TI selected by a TAO issues certificates\.$/, 'Vydávať môže len TI, ktorú vybral TAO.'],
  [/^The certificate does not fit the certificate scheme$/, 'Certifikát nezodpovedá schéme.'],
  // A TI's accreditation end (design decisions D23).
  [/^The TI's accreditation ended on (\S+)\.$/, 'Akreditácia TI skončila {1}.'],
  [
    /^A TI is selected with the date its accreditation ends\.$/,
    'TI sa vyberá s dátumom, do ktorého je akreditovaný.',
  ],
  [/^The accreditation end is not a date and time\.$/, 'Dátum konca akreditácie nie je platný.'],
  [
    /^An accreditation cannot end in the past; end it now instead\.$/,
    'Akreditácia nemôže skončiť v minulosti — ukončiť ju môžete hneď.',
  ],
  [
    /^An accreditation cannot be given for that long at once\.$/,
    'Na tak dlho naraz akreditáciu udeliť nemožno.',
  ],
  [/^Only a TI's accreditation has an end\.$/, 'Koniec má len akreditácia TI.'],
  [/^The accreditation has ended already\.$/, 'Akreditácia už skončila.'],
  [
    /^A TI's accreditation is extended or ended by the TAO that selected it\.$/,
    'Akreditáciu TI predlžuje alebo ukončuje TAO, ktorý ho vybral.',
  ],
  [/^Another TI issued this certificate\.$/, 'Tento certifikát vydal iný TI.'],
  // Each TI an issuer of its own (design decisions D27).
  [
    /^The TI is not set up as an issuer in EBSI yet\.$/,
    'TI ešte nie je v EBSI nastavená ako vydavateľ.',
  ],
  // Who suspends at once (design decisions D25).
  [
    /^Only the TI that issued this certificate, the TAO that selected that TI, or the RootTAO suspends it at once\.$/,
    'Núdzovo pozastaviť tento certifikát môže len TI, ktorá ho vydala, TAO, ktorý túto TI vybral, alebo RootTAO.',
  ],
  // Revoking an organization's accreditation (design decisions D24).
  [
    /^The accreditation of the certification body (.+) was revoked on (\S+)$/,
    'Akreditácia certifikačného orgánu {1} bola odňatá {2}.',
  ],
  [
    /^The accreditation of (.+) was revoked on (\S+)\.$/,
    'Akreditácia organizácie {1} bola odňatá {2}.',
  ],
  [
    /^Your organization's accreditation is revoked; it changes nothing in the chain\.$/,
    'Akreditácia vašej organizácie bola odňatá; v reťazci dôvery už nič nemení.',
  ],
  [
    /^The organization's accreditation is revoked, for good; select it anew instead\.$/,
    'Akreditácia organizácie je natrvalo odňatá; ak má pokračovať, vyberte ju nanovo.',
  ],
  [
    /^The organization's accreditation is revoked already\.$/,
    'Akreditácia organizácie už bola odňatá.',
  ],
  [/^Say why the accreditation is revoked\.$/, 'Uveďte, prečo sa akreditácia odníma.'],
  [/^Describe the reason in the note\.$/, 'Dôvod opíšte v poznámke.'],
  [/^The note is too long\.$/, 'Poznámka je príliš dlhá.'],
  [
    /^An organization's accreditation is revoked by the one that selected it\.$/,
    'Akreditáciu odníma len ten, kto organizáciu vybral.',
  ],
  // A status change's reason (D22).
  [
    /^A (\w+) needs one of these reasons: (.+)\.$/,
    'Úkon {1} potrebuje jeden z týchto dôvodov: {2}.',
  ],
  [/^Say what the other reason is\.$/, 'Uveďte, aký je iný dôvod.'],
  [/^A note is at most (\d+) characters\.$/, 'Poznámka môže mať najviac {1} znakov.'],
  [
    /^Only the RootTAO selects TAOs, and only a TAO selects TIs\.$/,
    'TAO vyberá len RootTAO a TI len TAO.',
  ],
  // Certificate schemas (design decisions D17).
  [/^Only schemas you hold can be handed on\.$/, 'Prideliť možno len schémy, ktoré sami máte.'],
  [
    /^An organization's schemas are set by the one that selected it\.$/,
    'Schémy organizácie mení len ten, kto ju vybral.',
  ],
  [/^Only the RootTAO defines certificate schemas\.$/, 'Schémy určuje len RootTAO.'],
  [
    /^This TI is not accredited to issue that certificate schema\.$/,
    'Táto TI nie je akreditovaná na vydávanie tejto schémy.',
  ],
  [/^The schema definition is not acceptable$/, 'Definícia schémy nie je prijateľná.'],
  [/^The organization needs a name$/, 'Organizácia musí mať názov.'],
  [/^The contact e-mail is not valid$/, 'Kontaktný e-mail nie je platný.'],
  [/^Unknown organization$/, 'Neznáma organizácia.'],
  [/^The organization has already registered$/, 'Organizácia je už registrovaná.'],
  [
    /^An organization's invitation is renewed by the one that selected it\.$/,
    'Pozvánku obnovuje ten, kto organizáciu vybral.',
  ],
  [/^The registration was refused$/, 'Registrácia bola odmietnutá.'],
  [/^Unknown request$/, 'Neznáma žiadosť.'],
  [/^Unknown certificate or purpose$/, 'Neznámy certifikát alebo účel.'],
  [/^Unknown certificate$/, 'Neznámy certifikát.'],
  [/^Unknown purpose (.+)$/, 'Neznámy účel {1}.'],
  [/^The certificate has expired\.$/, 'Platnosť certifikátu uplynula.'],
  [/^Could not build the request$/, 'Žiadosť sa nepodarilo zostaviť.'],
  [
    /^No issuance flow is configured for this type$/,
    'Pre tento typ nie je nastavený tok vydávania.',
  ],
  [/^No verify flow named (.+)$/, 'Neexistuje tok overenia s názvom {1}.'],
  [/^No signing key is available for (.+)$/, 'Pre {1} nie je k dispozícii podpisový kľúč.'],
  [/^action is required to propose\.$/, 'Na návrh je potrebný úkon.'],
  [/^value is the new threshold\.$/, 'Hodnota je nový prah.'],
  [/^value is the new timelock in seconds\.$/, 'Hodnota je nový časový zámok v sekundách.'],
  [
    /^value is 1 \(required\) or 0 \(not required\)\.$/,
    'Hodnota je 1 (povinné) alebo 0 (nepovinné).',
  ],
  [/^subject is the signer's address\.$/, 'Predmetom je adresa signatára.'],
  [
    /^(RoleRequired|RoleNotAssigned|RoleNotPermitted|NotApproved|NotAccredited|SigningRefused)$/,
    '{1}',
  ],
  // Verification outcomes (back-office/server/verification/credential.ts).
  [
    /^The certification body (.+) was not accredited when it issued the certificate$/,
    'Certifikačný orgán {1} nemal v čase vydania certifikátu platnú akreditáciu.',
  ],
  [/^The presentation did not pass verification$/, 'Prezentácia neprešla overením.'],
  [/^The presentation carried no credential$/, 'Prezentácia neobsahovala žiadny certifikát.'],
  [
    /^The credential was issued to someone other than the presenter$/,
    'Certifikát bol vydaný niekomu inému, než kto ho predložil.',
  ],
  [/^(\S+#\S+) is not in (\S+?)'s DID document$/, 'Kľúč {1} nie je v DID dokumente {2}.'],
  [/^Signed with a key of another DID \((.+)\)$/, 'Podpísané kľúčom iného DID ({1}).'],
  [/^The signature does not verify$/, 'Podpis nie je platný.'],
  [/^The signature names no key$/, 'Podpis neuvádza kľúč.'],
  [/^The JWS is invalid: (.+)$/, 'Podpísaný záznam (JWS) je neplatný: {1}'],
  [/^Not a compact JWS\.?$/, 'Nejde o podpísaný záznam (JWS).'],
  [/^The JWT carries no vc claim$/, 'Záznam neobsahuje certifikát (vc).'],
  [/^Unsupported algorithm (.+)$/, 'Nepodporovaný algoritmus {1}.'],
  [/^The credential names no issuer DID$/, 'Certifikát neuvádza DID vydavateľa.'],
  [/^The credential names no schema$/, 'Certifikát neuvádza schému.'],
  [/^Expired at (.+)$/, 'Platnosť uplynula {1}.'],
  [/^Valid from (.+)$/, 'Platný až od {1}.'],
  [/^Schema (\S+) could not be loaded$/, 'Schému {1} sa nepodarilo načítať.'],
  [/^Schema (\S+) is itself invalid$/, 'Schéma {1} je sama neplatná.'],
  [/^Does not match (\S+) at (\S+): (.+)$/, 'Nezodpovedá schéme {1} v {2}: {3}'],
  [/^Unsupported schema validator (.+)$/, 'Nepodporovaný validátor schémy {1}.'],
  [/^Accreditation of (\S+): (.+)$/, 'Akreditácia {1}: {2}'],
  [/^The accreditation of (\S+) is not in force$/, 'Akreditácia {1} nie je v platnosti.'],
  [/^The accreditation of (\S+) was revoked$/, 'Akreditácia {1} bola odňatá.'],
  [
    /^The accreditation was issued to someone other than (\S+)$/,
    'Akreditácia bola vydaná niekomu inému než {1}.',
  ],
  [
    /^The chain ends at (\S+), which is not a trusted root$/,
    'Reťazec končí pri {1}, ktorý nie je dôveryhodným koreňom.',
  ],
  [
    /^The accreditation chain does not end at a trusted root$/,
    'Akreditačný reťazec nekončí pri dôveryhodnom koreni.',
  ],
  [/^An accreditation in the chain no longer exists$/, 'Akreditácia v reťazci už neexistuje.'],
  [
    /^An accreditation points outside the Trusted Issuers Registry$/,
    'Akreditácia odkazuje mimo registra dôveryhodných vydavateľov (TIR).',
  ],
  [/^A TIR attribute carries no accreditation$/, 'Atribút v TIR neobsahuje akreditáciu.'],
  [/^The TIR attribute link points elsewhere$/, 'Odkaz atribútu v TIR smeruje inam.'],
  [
    /^The TIR answered in a shape this verifier does not accept$/,
    'TIR odpovedal v tvare, ktorý overovateľ neprijíma.',
  ],
  [/^Issued by (\S+), expected (\S+)$/, 'Vydal {1}, očakávaný vydavateľ je {2}.'],
  // The governance contract's record, the only source of truth about a
  // certificate (design decisions D34, D36), what the holder disclosed, and the
  // holder's own exchange (D35).
  [
    /^The TI has already issued a certificate with number (.+)\.$/,
    'TI už vydala certifikát s číslom {1}.',
  ],
  [/^The certificate needs its number\.$/, 'Certifikát potrebuje číslo.'],
  [
    /^The credential names no record on the governance contract$/,
    'Certifikát neuvádza svoj záznam v kontrakte riadenia.',
  ],
  [/^No governance contract is configured here$/, 'Overovateľ nemá nastavený kontrakt riadenia.'],
  [
    /^The credential names a governance contract other than the registry's$/,
    'Certifikát uvádza iný kontrakt riadenia, než aký používa register.',
  ],
  [/^The governance contract could not be read$/, 'Kontrakt riadenia sa nepodarilo prečítať.'],
  [
    /^The certificate does not match its record on the governance contract \((.+)\)$/,
    'Certifikát nezodpovedá svojmu záznamu v kontrakte riadenia ({1}).',
  ],
  [
    /^The disclosures do not match the certificate: (.+)$/,
    'Zdieľané údaje nezodpovedajú tomu, čo vydavateľ podpísal: {1}',
  ],
  [
    /^A key-binding JWT is not expected after the disclosures$/,
    'Za zdieľanými údajmi nemá nasledovať ďalší podpísaný token.',
  ],
  [
    /^The presentation does not show what the verifier requires: (.+)$/,
    'Prezentácia neukazuje, čo overovateľ vyžaduje: {1}.',
  ],
  [
    /^The governance contract records the certificate as suspended$/,
    'Kontrakt riadenia vedie certifikát ako pozastavený.',
  ],
  [
    /^The governance contract records the certificate as revoked$/,
    'Kontrakt riadenia vedie certifikát ako odňatý.',
  ],
  [
    /^The governance contract has no record of the certificate yet$/,
    'Kontrakt riadenia certifikát ešte nemá zapísaný.',
  ],
  [/^The holder's answer holds no presentation$/, 'Odpoveď držiteľa neobsahuje prezentáciu.'],
  [/^Not the QR code of a wallet's exchange$/, 'Toto nie je QR kód z peňaženky (Preukázať sa).'],
  [/^The exchange is not named by an IP address$/, 'QR kód neurčuje peňaženku IP adresou.'],
  [/^Not an exchange URL$/, 'Adresa v QR kóde nevedie na výmenu v peňaženke.'],
  [/^Not a port a wallet listens on$/, 'Na porte z QR kódu peňaženka nepočúva.'],
  [
    /^(\S+) is outside the networks this verifier connects to$/,
    'Adresa {1} je mimo sietí, ku ktorým sa tento overovateľ pripája.',
  ],
  [/^The invitation carries no token$/, 'QR kód neobsahuje token výmeny.'],
  [/^The invitation carries no P-256 key$/, 'QR kód neobsahuje kľúč P-256.'],
  [
    /^The holder's wallet cannot be reached\b.*$/,
    'Peňaženka držiteľa nie je dostupná. Je telefón v tej istej sieti ako back-office a platí ešte jeho QR kód (2 minúty)?',
  ],
  [
    /^The holder's exchange has closed$/,
    'Výmena v peňaženke držiteľa sa skončila. Nech ukáže nový QR kód.',
  ],
  [/^The holder's wallet answered (\d+)$/, 'Peňaženka držiteľa odpovedala kódom {1}.'],
];

const TERMS = {
  revocation: 'odňatia',
  suspension: 'pozastavenia',
};

/**
 * A message from the back-office or the verifier, in the active language.
 * @param message - Existing backend message or timeout explanation.
 * @returns The localized known backend message, or its original text when no rule matches.
 */
export function serverMessage(message) {
  const text = String(message ?? '').trim();
  if (getLang() !== 'sk' || !text) return text;
  // "STATE — reason": the state is a code, the reason is translated.
  const coded = /^([A-Z_]{4,}) — (.+)$/.exec(text);
  if (coded) return `${coded[1]} — ${serverMessage(coded[2])}`;
  for (const [pattern, template] of SERVER) {
    const m = pattern.exec(text);
    if (m) return template.replace(/\{(\d)\}/g, (_, i) => TERMS[m[+i]] ?? m[+i]);
  }
  return text;
}

/**
 * Format {field: ["message"]} validation responses as readable lines.
 * @param payload - Existing JSON payload required by the selected backend endpoint.
 * @returns Readable field/message lines, or an empty string when the response is not a field-error object.
 */
export function fieldErrors(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return Object.entries(payload)
    .filter(([, value]) => Array.isArray(value) && value.every((v) => typeof v === 'string'))
    .map(([field, value]) => `${field}: ${(value as string[]).map(serverMessage).join(' ')}`)
    .join('\n');
}
