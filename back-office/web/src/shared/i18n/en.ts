// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

// English console translations use each Slovak message as the key.
// A missing entry displays the Slovak message.

export default {
  Vydanie: 'Issuance',
  'Registrácia certifikátov a odovzdanie ponuky do peňaženky držiteľa.':
    "Register certificates and hand the offer over to the holder's wallet.",
  'Životný cyklus': 'Lifecycle',
  'Pozastavenie, odňatie a obnovenie certifikátov podľa štvor-okého princípu.':
    'Suspend, revoke and reinstate certificates under the four-eyes principle.',
  'Niektoré certifikáty sa nedajú zobraziť, lebo ich údaje sa nepodarilo dešifrovať (počet: {0}). KMS je nedostupný alebo stratil kľúč, ktorým boli zašifrované. Kým sa to nevyrieši, tieto certifikáty sa tu nedajú spravovať.':
    'Some certificates cannot be shown because their data could not be decrypted (count: {0}). The KMS is unavailable or has lost the key they were encrypted with. Until that is resolved, these certificates cannot be managed here.',
  'Životný cyklus zatiaľ nie je dostupný.': 'Lifecycle is not available yet.',
  'Zoznam certifikátov sa zobrazí po tom, ako bude back-office pripravený alebo keď vznikne prvý certifikát.':
    'The certificate list will appear once the back office is ready or after the first certificate exists.',
  Overenie: 'Verification',
  'Overenie certifikátu predloženého z peňaženky držiteľa.':
    "Verify a certificate presented from the holder's wallet.",
  Riadenie: 'Governance',
  'Hlasovanie o návrhoch a pravidlách kontraktu riadenia na ledgeri.':
    "Vote on the governance contract's proposals and rules on the ledger.",
  Audit: 'Audit',
  'Register odbornej spôsobilosti': 'Register of professional competence',
  Sekcie: 'Sections',
  Odhlásiť: 'Sign out',
  'Nemáte pridelenú žiadnu rolu registra. Pridelí ju správca zaradením do skupiny plr_issuer, plr_status_manager, plr_verifier, plr_auditor, plr_rtao alebo plr_tao.':
    'You have no registry role. An administrator assigns one by adding you to the group plr_issuer, plr_status_manager, plr_verifier, plr_auditor, plr_rtao or plr_tao.',
  'Register · back-office': 'Register · back-office',
  Jazyk: 'Language',
  'Načítava sa profil používateľa.': 'Loading user profile.',
  'Táto časť sa nepodarila zobraziť.': 'This section could not be displayed.',
  'Môžete skúsiť obrazovku obnoviť alebo prejsť na inú sekciu. Navigácia a odhlásenie zostávajú dostupné.':
    'You can try the screen again or move to another section. Navigation and sign-out remain available.',
  'Aplikácia zachytila chybu v tejto časti stránky.':
    'The application caught an error in this part of the page.',
  'Skúsiť znova': 'Try again',
  blok: 'block',
  nedostupné: 'unavailable',
  Kontrakt: 'Contract',
  'kliknutím nastavíte adresu': 'click to set the address',
  nenastavený: 'not set',
  'adresu určuje back-office': 'the back-office sets the address',
  'Kopírovať adresu kontraktu': 'Copy contract address',
  'Upraviť adresu kontraktu': 'Edit contract address',
  'Nastaviť adresu kontraktu': 'Set contract address',
  Skopírované: 'Copied',
  'Kopírovanie zlyhalo': 'Copy failed',
  'Back-office konzola pre certifikačné orgány, správcov statusov, overovateľov a audítorov.':
    'The back-office console for certification bodies, status managers, verifiers and auditors.',
  'Vydávanie certifikátov do peňaženky EBSI': 'Certificates issued to an EBSI wallet',
  'Štvor-oký princíp a riadenie na ledgeri': 'The four-eyes principle and governance on the ledger',
  'Overenie a audit každého rozhodnutia': 'Every decision verifiable and audited',
  'Manažér kybernetickej bezpečnosti': 'Cybersecurity manager',
  Prihlásenie: 'Sign in',
  'Back-office konzola registra odbornej spôsobilosti.':
    'Back-office console of the register of professional competence.',
  'Relácia vypršala po 15 minútach nečinnosti. Prihláste sa znova.':
    'Your session expired after 15 minutes of inactivity. Please sign in again.',
  'Backend vrátil chybovú stránku: {0}': 'The backend returned an error page: {0}',
  'Backend vrátil HTML chybovú stránku (HTTP {0}).':
    'The backend returned an HTML error page (HTTP {0}).',
  'Backend neodpovedá. Skontrolujte, či je MVP spustené, a skúste to znova.':
    'The backend is not responding. Check that the MVP is running and try again.',
  Používateľ: 'User',
  'napr. alice': 'e.g. alice',
  Heslo: 'Password',
  'Zadajte heslo': 'Enter your password',
  'Prihlasuje sa…': 'Signing in…',
  Prihlásiť: 'Sign in',
  'Vývojové prostredie:': 'Development environment:',
  'vydáva a spravuje statusy,': 'issues and manages statuses,',
  'spravuje statusy,': 'manages statuses,',
  'je audítor a RootTAO,': 'is the auditor and the RootTAO,',
  'je TAO — vytvára ich': 'is the TAO — created by',
  '. Štvor-oký princíp vyžaduje, aby návrh a schválenie robili dvaja rôzni ľudia.':
    '. The four-eyes principle requires the proposal and the approval to come from two different people.',
  'Auditný záznam': 'Audit log',
  'Záznamy sa nedajú upraviť ani zmazať a sú zreťazené hashmi, takže zásah priamo v databáze je zistiteľný (komponent 1).':
    'Entries cannot be edited or deleted and are chained by hashes, so tampering directly in the database is detectable (component 1).',
  'credential_id (voliteľné)': 'credential_id (optional)',
  'napr. urn:uuid:… alebo spis-2026-0001': 'e.g. urn:uuid:… or case-2026-0001',
  'napr. 12': 'e.g. 12',
  Filtrovať: 'Filter',
  Čas: 'Time',
  Udalosť: 'Event',
  Kto: 'Who',
  Detail: 'Detail',
  systém: 'system',
  'Sprístupnenie sa zaznamená do audit logu.': 'The disclosure will be recorded in the audit log.',
  Sprístupniť: 'Disclose',
  'Sprístupňuje sa…': 'Disclosing…',
  'Audit certifikátu': 'Certificate audit',
  'Rozhodnutia ukotvené v EBSI Timestamp API (komponent 9) a overenie, že návrh v kontrakte riadenia patrí k tomuto certifikátu (komponent 10.7).':
    'Decisions anchored in the EBSI Timestamp API (component 9), and a check that the proposal in the governance contract belongs to this certificate (component 10.7).',
  'Ukotvené rozhodnutia': 'Anchored decisions',
  'Žiadne ukotvené rozhodnutia.': 'No anchored decisions.',
  Rozhodnutie: 'Decision',
  Ukotvené: 'Anchored',
  'Záznam sedí s digestom': 'Record matches the digest',
  'Digest na ledgeri': 'Digest on the ledger',
  čaká: 'pending',
  'číslo návrhu': 'proposal number',
  'Overiť v kontrakte': 'Verify in the contract',
  'Zhoda — návrh na chaine patrí k tomuto certifikátu.':
    'Match — the on-chain proposal belongs to this certificate.',
  áno: 'yes',
  nie: 'no',
  'Reťazec hashov je neporušený.': 'The hash chain is intact.',
  'Zásah do audit logu:': 'Audit log tampering:',
  'zmenené záznamy #': 'altered entries #',
  'Chýbajúci predchodca pri #': 'Missing predecessor at #',
  '— záznam bol zmazaný.': '— an entry was deleted.',
  'Žiadny záznam nebol zmenený ani zmazaný. Reťazec má':
    'No entry was altered or deleted. The chain has',
  'rozvetvenie(a) pri #': 'fork(s) at #',
  ': dva zápisy v tom istom okamihu nadviazali na rovnakého predchodcu. Zápis je odvtedy serializovaný; staré záznamy sa neprepisujú — log je len na pripisovanie.':
    ': two writes at the same moment followed the same predecessor. Writing has been serialised since; old entries are not rewritten — the log is append-only.',
  'certifikačný orgán · navrhovateľ': 'certification body · proposer',
  'certifikačný orgán · druhý schvaľovateľ': 'certification body · second approver',
  'orgán dohľadu': 'supervisory authority',
  pozastavenie: 'suspension',
  odňatie: 'revocation',
  obnovenie: 'reinstatement',
  'Podpis je na chaine.': 'The signature is on chain.',
  'Návrh je vykonaný. Back-office teraz zmení stav certifikátu.':
    "The proposal has been executed. The back-office now changes the certificate's status.",
  'Návrh je vetovaný a uzavretý. Certifikát ostáva bez zmeny.':
    'The proposal has been vetoed and closed. The certificate stays unchanged.',
  'Návrh je uvoľnený; certifikát je možné navrhnúť znova.':
    'The proposal has been released; the certificate can be proposed again.',
  'overuje sa, či kontrakt hlas prijme…': 'checking whether the contract will accept the vote…',
  'potvrďte transakciu v peňaženke…': 'confirm the transaction in your wallet…',
  'transakcia je odoslaná, čaká sa na zápis do bloku…':
    'transaction sent, waiting for it to be included in a block…',
  'Vetovať návrh #{0} ({1})?': 'Veto proposal #{0} ({1})?',
  'Vetovať návrh': 'Veto proposal',
  'Veto jedného oprávneného signatára návrh okamžite uzavrie.':
    'A veto from one authorized signer closes the proposal immediately.',
  'Certifikát zostane bez zmeny; rovnakú zmenu možno navrhnúť znova.':
    'The certificate will remain unchanged; the same change can be proposed again.',
  ' Back-office sa o hlase zatiaľ nedozvedel — prihláste sa a skúste to znova.':
    ' The back-office has not learned about the vote yet — sign in and try again.',
  'Schválené v back-office ako druhý pracovník (štvor-oký princíp). Podpis roly B sa odosiela na chain.':
    "Approved in the back-office as the second officer (four-eyes principle). Role B's signature is being sent on chain.",
  'Kontrakt riadenia': 'Governance contract',
  'Nie je nakonfigurovaný žiadny kontrakt. Back-office beží len na štvor-okom princípe, čo je pilotný stav pred nasadením kontraktu.':
    'No contract is configured. The back-office runs on the four-eyes principle alone, the pilot state before the contract is deployed.',
  'Komponent 10.4 označuje obe kontroly za súbežné a chrániace pred odlišnými hrozbami, takže neprítomnosť kontraktu neoslabuje aplikačnú kontrolu. Nasadenie:':
    'Component 10.4 treats both controls as parallel and protecting against different threats, so the absence of the contract does not weaken the application control. Deployment:',
  'Čítané priamo z ledgeru, nie z back-office. Kontrakt nemení statusy — zaznamenáva, že zmenu schválilo kvórum (komponent 10.5).':
    'Read directly from the ledger, not from the back-office. The contract does not change statuses — it records that a quorum approved the change (component 10.5).',
  adresa: 'address',
  '{0} z {1}': '{0} of {1}',
  signatári: 'signers',
  'platnosť návrhu': 'proposal lifetime',
  'bez obmedzenia': 'unlimited',
  'počet návrhov': 'number of proposals',
  'Ledger neodpovedá. Skontrolujte Besu RPC a skúste obnoviť stránku.':
    'The ledger is not responding. Check Besu RPC and refresh the page.',
  'Načítava sa stav kontraktu z ledgeru…': 'Loading the contract state from the ledger…',
  'Načítava sa…': 'Loading…',
  Obnoviť: 'Refresh',
  Hlasovanie: 'Voting',
  'Návrh na chaine otvorí back-office, keď pracovník navrhne zmenu v Životnom cykle — a jeho rola ho zároveň podpíše. Tu sa pridávajú ďalšie podpisy, návrh sa vykonáva alebo vetuje. Externá peňaženka znamená blockchain peňaženku signatára v prehliadači, nie mobilný Atest Wallet držiteľa.':
    "The back-office opens an on-chain proposal when an officer proposes a change in Lifecycle — and their role signs it at the same time. Further signatures are added here, and the proposal is executed or vetoed. External wallet means a signer's browser blockchain wallet, not the holder's mobile Atest Wallet.",
  'Rola cez back-office': 'Role via the back-office',
  'Externá peňaženka signatára': 'External signer wallet',
  'Spôsob hlasovania': 'Voting method',
  'Návrhy na chaine': 'On-chain proposals',
  'Návrh #': 'Proposal #',
  'Zatiaľ žiadne návrhy.': 'No proposals yet.',
  Úkon: 'Action',
  Stav: 'Status',
  Podpisy: 'Signatures',
  Vykonateľné: 'Executable',
  'Pravidlo už má túto hodnotu.': 'The rule already has this value.',
  'Zmena pravidiel je navrhnutá.': 'The rule change has been proposed.',
  'Pravidlá kontraktu': 'Contract rules',
  Zmena: 'Change',
  ' (súčasný)': ' (current)',
  ' — nedá sa odobrať': ' — cannot be removed',
  'Odosiela sa…': 'Sending…',
  'Navrhnúť zmenu': 'Propose the change',
  'Podpisuje sa…': 'Signing…',
  Podpísané: 'Signed',
  'Čaká na dohľad': 'Waiting for the supervisor',
  Podpísať: 'Sign',
  ' Hlasujete ako orgán dohľadu, takže každú z týchto zmien môžete otvoriť.':
    ' You vote as the supervisory authority, so you can open any of these changes.',
  'Back-office nemá nakonfigurovaný kontrakt (': 'The back-office has no contract configured (',
  '), takže cez back-office hlasovať nemožno. Externou peňaženkou signatára áno.':
    '), so you cannot vote through the back-office. You can with an external signer wallet.',
  'Nemáte pridelenú žiadnu rolu riadenia. Hlasovať za certifikačný orgán môže len ten, koho správca zaradí do skupiny':
    'You have no governance role. Only someone an administrator adds to the group',
  ' alebo ': ' or ',
  '. Byť prihlásený nestačí — ani ako administrátor.':
    ' can vote for the certification body. Being signed in is not enough — not even as an administrator.',
  'Hlasovať ako': 'Vote as',
  'V tomto nasadení drží back-office aj kľúč orgánu dohľadu. Na demo to stačí, no nezávislosť tretieho podpisu je potom len simulovaná — v produkcii má tento kľúč výhradne orgán dohľadu.':
    "In this deployment the back-office also holds the supervisory authority's key. That is enough for a demo, but the independence of the third signature is then only simulated — in production only the supervisory authority holds this key.",
  'Kľúč roly je v KMS a nikto ho nevidí — ani konzola, ani back-office. Back-office zostaví transakciu a požiada KMS o podpis, len ak ide presne o schválený úkon. Podpis za rolu':
    "The role's key is in the KMS and nobody sees it — neither the console nor the back-office. The back-office builds the transaction and requests its KMS signature only for the exact approved action. Signing for the role",
  'na návrhu, ktorý v back-office ešte nikto neschválil, je zároveň tým schválením — preto ho musí urobiť iný človek, než kto zmenu navrhol. Rola orgánu dohľadu tu zámerne nie je: jeho podpis má cenu len vtedy, keď ho urobí vlastným kľúčom mimo systémov certifikačného orgánu (komponent 10.2).':
    "on a proposal nobody has approved in the back-office yet is that approval as well — so it must be done by someone other than the person who proposed the change. The supervisory authority's role is deliberately not here: its signature is worth something only when it is made with its own key outside the certification body's systems (component 10.2).",
  'Ide o externú blockchain peňaženku signatára, napríklad MetaMask — nie o mobilnú peňaženku Atest držiteľa certifikátu.':
    "This means an external signer blockchain wallet, such as MetaMask — not the certificate holder's mobile Atest Wallet.",
  '(verejne známy testovací kľúč). Sieť: chain': '(a publicly known test key). Network: chain',
  'Pripojiť peňaženku': 'Connect wallet',
  účet: 'account',
  sieť: 'network',
  rola: 'role',
  'signatár ·': 'signer ·',
  'nie je signatár': 'not a signer',
  'Peňaženka je na sieti': 'The wallet is on network',
  ', kontrakt je na': ', the contract is on',
  'Prepnúť sieť': 'Switch network',
  'Tento účet nie je signatárom. Môže iba uvoľniť expirované návrhy — to kontrakt dovoľuje komukoľvek.':
    'This account is not a signer. It can only release expired proposals — the contract allows anyone to do that.',
  'Podpisuje peňaženka; kľúč z nej neodchádza a stránka vidí len adresu a hash transakcie. Tak hlasuje orgán dohľadu — bez prístupu k systémom certifikačného orgánu. Po hlasovaní konzola požiada back-office, aby si stav kontraktu znova prečítal; výsledok hlasu mu tým nediktuje, len ho upozorní.':
    "The wallet signs; the key never leaves it and the page sees only the address and the transaction hash. This is how the supervisory authority votes — without access to the certification body's systems. After a vote, the console asks the back-office to re-read the contract's state; it does not dictate the outcome, it only notifies it.",
  podpísal: 'signed',
  nepodpísal: 'not signed',
  'Časový zámok platí do {0}': 'Timelock runs until {0}',
  'Vykonáva sa…': 'Executing…',
  'Čaká na časový zámok': 'Waiting for the timelock',
  Vykonať: 'Execute',
  'Vetuje sa…': 'Vetoing…',
  Vetovať: 'Veto',
  'Návrh prekročil lehotu, no stále blokuje certifikát pred novým návrhom.':
    'The proposal has passed its deadline but still blocks the certificate from a new proposal.',
  'Uvoľňuje sa…': 'Releasing…',
  Uvoľniť: 'Release',
  'Auditné overenie': 'Audit check',
  'ID návrhu': 'Proposal ID',
  'DID vydavateľa': 'Issuer DID',
  'Soľ má 64 hex znakov (32 bajtov).': 'The salt is 64 hex characters (32 bytes).',
  'Platnosť do nemôže byť v minulosti — certifikát by sa nedal vyzdvihnúť.':
    'Valid until cannot be in the past — the certificate could not be collected.',
  'Vydať certifikát': 'Issue certificate',
  'Interná referencia držiteľa': 'Internal holder reference',
  'napr. spis-2026-0001': 'e.g. file-2026-0001',
  'Číslo osvedčenia': 'Certificate number',
  'napr. SK-CSM-2026-000123': 'e.g. SK-CSM-2026-000123',
  'Certifikačný orgán': 'Certification body',
  'napr. CertOrg s.r.o.': 'e.g. CertOrg Ltd.',
  'Certifikačná schéma': 'Certification scheme',
  'Verzia schémy': 'Scheme version',
  'Platnosť do (voliteľné)': 'Valid until (optional)',
  'Vyberte dátum': 'Select a date',
  'Referencia držiteľa je pseudonymný kľúč do internej evidencie — nikdy nie meno a nikdy nie DID držiteľa (komponent 1.2). Atribúty sa uložia šifrovane a stanú sa z nich':
    "The holder reference is a pseudonymous key into internal records — never a name and never the holder's DID (component 1.2). The attributes are stored encrypted and become",
  '; DID držiteľa doplní Issuer Service až pri uplatnení ponuky. Stav':
    "; the Issuer Service adds the holder's DID only when the offer is redeemed. The status",
  'sa odvodzuje z': 'is derived from',
  'Vydáva sa…': 'Issuing…',
  'Platný do': 'Valid until',
  platný: 'valid',
  nastavený: 'set',
  Pozastaviť: 'Suspend',
  Odňať: 'Revoke',
  'Obnoviť platnosť': 'Reinstate',
  pozastavený: 'suspended',
  odňatý: 'revoked',
  exspirovaný: 'expired',
  'Návrh „{0}“ pre {1} je zaevidovaný. Schváliť ho musí iný správca statusov.':
    'The proposal “{0}” for {1} has been recorded. Another status manager must approve it.',
  'Schválené a vykonané — certifikát je {0}.': 'Approved and executed — the certificate is {0}.',
  'Schválené. Zmena nastane, keď ju potvrdí kontrakt riadenia (komponent 10.5).':
    'Approved. The change takes effect when the governance contract confirms it (component 10.5).',
  'Návrh je zamietnutý; certifikát ostáva bez zmeny.':
    'The proposal has been rejected; the certificate stays unchanged.',
  '{0} je pozastavený.': '{0} is suspended.',
  Certifikáty: 'Certificates',
  Platné: 'Valid',
  Pozastavené: 'Suspended',
  Odňaté: 'Revoked',
  'Čakajúce návrhy': 'Pending proposals',
  'Schváliť môže len iný správca statusov než ten, kto zmenu navrhol (štvor-oký princíp, komponent 1).':
    'Only a status manager other than the one who proposed the change can approve it (four-eyes principle, component 1).',
  Certifikát: 'Certificate',
  Navrhol: 'Proposed by',
  Dôvod: 'Reason',
  'schválený · na chaine {0}': 'approved · on chain {0}',
  'na chaine #{0}': 'on chain #{0}',
  'čaká na schválenie': 'awaiting approval',
  'Vlastný návrh schváliť nemôžete.': 'You cannot approve your own proposal.',
  Schváliť: 'Approve',
  Zamietnuť: 'Reject',
  'Zobraziť menej': 'Show less',
  'Zobraziť všetky ({0})': 'Show all ({0})',
  'Zobrazených {0} najnovších z {1}.': 'Showing the {0} most recent of {1}.',
  'Vydané certifikáty': 'Issued certificates',
  'Zobrazených {0} z {1}.': 'Showing {0} of {1}.',
  'Načítať ďalšie': 'Load more',
  'Každý riadok ponúka len prechody, ktoré jeho stav a vaše roly dovoľujú. Návrh sám o sebe nič nemení.':
    'Each row offers only the transitions its status and your roles allow. A proposal on its own changes nothing.',
  všetky: 'all',
  platné: 'valid',
  pozastavené: 'suspended',
  odňaté: 'revoked',
  'Vyhľadať certifikát': 'Search certificate',
  'Hľadá v čísle osvedčenia, internej referencii a technickom ID credentialu.':
    'Searches the certificate number, internal reference and technical credential ID.',
  'napr. 121 alebo spis-2026-0001': 'e.g. 121 or file-2026-0001',
  Vyhľadať: 'Search',
  Vyčistiť: 'Clear',
  'Žiadne certifikáty.': 'No certificates.',
  'Pre tento filter sa nenašiel žiadny certifikát.': 'No certificate matches this filter.',
  Referencia: 'Reference',
  'Platnosť do': 'Valid until',
  Akcia: 'Action',
  Akcie: 'Actions',
  nevyzdvihnutý: 'not collected',
  'Núdzovo pozastaviť': 'Emergency suspend',
  'Núdzovo pozastaviť môžete len certifikáty, ktoré vydala vaša organizácia.':
    'You can emergency-suspend only the certificates your organization issued.',
  'Núdzovo pozastaviť môžete certifikáty TI, ktoré ste vybrali.':
    'You can emergency-suspend the certificates of the TIs you selected.',
  'Núdzovo pozastaviť môžete ktorýkoľvek certifikát v registri.':
    'You can emergency-suspend any certificate in the registry.',
  'Núdzovo pozastavuje len TI, ktorá certifikát vydala, TAO, ktorý túto TI vybral, alebo RootTAO.':
    'Only the TI that issued a certificate, the TAO that selected that TI, or the RootTAO can emergency-suspend it.',
  'Nová ponuka': 'New offer',
  'Nová ponuka — {0}': 'New offer — {0}',
  'Odovzdanie do peňaženky': 'Hand over to the wallet',
  'Ponuka platí pre tento jeden certifikát a dá sa uplatniť raz.':
    'The offer is for this one certificate and can be redeemed once.',
  'Platí do': 'Valid until',
  'QR kód s ponukou certifikátu': 'QR code with the certificate offer',
  'PIN pre držiteľa': 'PIN for the holder',
  'Povedzte ho držiteľovi alebo mu ho pošlite iným kanálom než QR kód. Peňaženka si ho vypýta po naskenovaní. Zobrazí sa len teraz — back-office si ho neuchováva; po piatich zlých pokusoch ponuka prepadne.':
    'Tell it to the holder or send it through a channel other than the QR code. The wallet asks for it after scanning. It is shown only now — the back-office does not keep it; after five wrong attempts the offer lapses.',
  'Overiť certifikát': 'Verify a certificate',
  'Vytvorí žiadosť o predloženie a čaká, kým ju držiteľ v peňaženke potvrdí. Peňaženka odpovedá vydavateľovi, nie tejto stránke, takže výsledok sa páruje cez':
    'Creates a presentation request and waits for the holder to confirm it in the wallet. The wallet answers the issuer, not this page, so the result is matched through',
  'žiadosti.': 'of the request.',
  'Nová žiadosť': 'New request',
  'Požiadať o predloženie': 'Request a presentation',
  'Vytvára sa žiadosť…': 'Creating request…',
  'Vytvára sa QR žiadosť…': 'Creating QR request…',
  'Žiadosť o predloženie sa nepodarilo vytvoriť včas. Skontrolujte backend a skúste to znova.':
    'The presentation request could not be created in time. Check the backend and try again.',
  'QR kód sa nepodarilo pripraviť. Skúste vytvoriť novú žiadosť.':
    'The QR code could not be prepared. Try creating a new request.',
  'QR kód so žiadosťou o predloženie': 'QR code with the presentation request',
  'Čaká sa na držiteľa…': 'Waiting for the holder…',
  'Ako to skúsiť': 'How to try it',
  'V peňaženke': 'In the wallet',
  nestačí: 'it is not enough to',
  'otvoriť kartu „Prezentácie" — tá je len zoznamom už vykonaných predložení a pri našom toku ostáva prázdna. Predkladá sa naskenovaním tejto žiadosti tlačidlom':
    'open the “Presentations” tab — it only lists presentations already made and stays empty in this flow. You present by scanning this request with the button',
  Skenovať: 'Scan',
  'na karte „Licencie".': 'on the “Licenses” tab.',
  'Certifikát je platný: všetky podmienky 6.3 sú splnené.':
    'The certificate is valid: all conditions of 6.3 are met.',
  'Certifikát je pozastavený. Pozastavenie je vratné, no kým trvá, osvedčenie neplatí.':
    'The certificate is suspended. Suspension is reversible, but while it lasts the certificate is not valid.',
  'Certifikát bol odňatý. Odňatie je trvalé.':
    'The certificate has been revoked. Revocation is permanent.',
  'Platnosť certifikátu uplynula (validUntil).': 'The certificate has expired (validUntil).',
  'Certifikát ešte nenadobudol platnosť (validFrom).':
    'The certificate is not valid yet (validFrom).',
  'Vydavateľ nie je dôveryhodný: chýba alebo neplatí akreditačný reťazec v TIR.':
    'The issuer is not trusted: the accreditation chain in the TIR is missing or invalid.',
  'Podpis certifikátu nie je platný alebo kľúč nepatrí vydavateľovi.':
    "The certificate's signature is invalid or the key does not belong to the issuer.",
  'Stav sa nedá s istotou určiť: kontrakt riadenia certifikát ešte nemá zapísaný alebo sa nedá prečítať. Nikdy to neznamená „platný“.':
    'The status cannot be determined reliably: the governance contract has no record of the certificate yet or cannot be read. This never means “valid”.',
  'Overenie nemožno dokončiť. Výsledok nie je „platný“.':
    'The verification cannot be completed. The result is not “valid”.',
  'VP je platná (nonce, audience, ochrana proti replay)':
    'the VP is valid (nonce, audience, replay protection)',
  'podpis VC je platný': 'the VC signature is valid',
  'issuer DID je rozlíšiteľný a kľúč platný': 'the issuer DID resolves and the key is valid',
  'akreditácia issuera je platná pre daný typ credentialu':
    "the issuer's accreditation is valid for this credential type",
  'credential zodpovedá obom schémam': 'the credential matches both schemas',
  'časová platnosť VC je splnená': 'the VC is within its validity period',
  'holder binding je overený': 'holder binding is verified',
  'TI (vydavateľ)': 'TI (issuer)',
  'dôveryhodný koreň': 'trusted root',
  'Nevyhodnotené — overenie sa zastavilo skôr, alebo sa podmienka netýka':
    'Not evaluated — the verification stopped earlier, or the condition does not apply',
  Overené: 'Verified',
  Prijateľné: 'Accepted',
  Typy: 'Types',
  'Podmienky platnosti (6.3)': 'Validity conditions (6.3)',
  'Pre certifikát, ktorý rozhodol. Výsledok je VALID, len ak platia všetky; „—“ znamená, že sa overenie k podmienke nedostalo.':
    'For the certificate that decided the outcome. The result is VALID only if all of them hold; “—” means the verification did not reach the condition.',
  'Z prezentácie sa nikdy neukladá samotná prezentácia ani DID držiteľa (komponent 1.2). Údaje certifikátu sa ukážu len na krátky čas a potom sa zmažú; výsledok a dôkazy k nemu zostávajú.':
    "Neither the presentation itself nor the holder's DID is ever stored (component 1.2). The certificate's data is shown only briefly and then deleted; the result and its evidence remain.",
  'Predložené údaje': 'Presented data',
  'Zobrazené do': 'Shown until',
  ', potom sa zmažú (komponent 1.2).': ', then deleted (component 1.2).',
  'Nezobrazujú sa — podpis neplatí, údaje nemožno pripísať vydavateľovi.':
    'Not shown — the signature is invalid, so the data cannot be attributed to the issuer.',
  'Nezobrazujú sa — certifikát nepredložil jeho držiteľ.':
    'Not shown — the certificate was not presented by its holder.',
  'Už sa nezobrazujú — uchovávajú sa len krátko po overení (komponent 1.2).':
    'No longer shown — they are kept only briefly after verification (component 1.2).',
  'Nezobrazujú sa — overenie sa k nim nedostalo.':
    'Not shown — the verification did not reach them.',
  Platnosť: 'Validity',
  'Platný od': 'Valid from',
  'Vydavateľ a podpis (DIDR)': 'Issuer and signature (DIDR)',
  Vydavateľ: 'Issuer',
  Kľúč: 'Key',
  'DID dokument k': 'DID document as of',
  '— stav ku dňu vydania (D10)': '— as of the issuance date (D10)',
  'Akreditačný reťazec (TIR)': 'Accreditation chain (TIR)',
  'Nevyhodnotený — overenie sa zastavilo pred ním.':
    'Not evaluated — the verification stopped before it.',
  'Schémy (TSR)': 'Schemas (TSR)',
  'Nevyhodnotené.': 'Not evaluated.',
  Zoznam: 'List',
  'Nevyhodnotené — overenie sa zastavilo pred kontrolou stavu.':
    'Not evaluated — the verification stopped before the status check.',
  // The holder's QR code and the governance contract's record (design decisions D34, D35).
  'Pripája sa k peňaženke držiteľa…': "Connecting to the holder's wallet…",
  'Peňaženka dostala žiadosť. Čaká sa, kým ju držiteľ potvrdí PIN-om…':
    'The wallet has the request. Waiting for the holder to confirm it with the PIN…',
  'Držiteľ žiadosť v peňaženke odmietol.': 'The holder declined the request in the wallet.',
  'Žiadosť vypršala bez odpovede. Vytvorte novú.':
    'The request expired without an answer. Create a new one.',
  'Výmena v peňaženke skončila. Nech držiteľ ukáže nový QR kód.':
    "The wallet's exchange has ended. Ask the holder to show a new QR code.",
  'Peňaženka držiteľa prestala odpovedať. Je telefón stále v tej istej Wi-Fi?':
    "The holder's wallet stopped answering. Is the phone still on the same Wi-Fi?",
  'Odpoveď peňaženky sa nepodarilo prečítať.': "The wallet's answer could not be read.",
  'Kamera nie je dostupná. Nahrajte fotografiu QR kódu alebo vložte jeho obsah.':
    'The camera is not available. Upload a photo of the QR code or paste what it says.',
  'Na obrázku sa nenašiel QR kód.': 'No QR code was found in the image.',
  'Obrázok sa nepodarilo načítať.': 'The image could not be loaded.',
  'Overiť z telefónu držiteľa': "Verify from the holder's phone",
  'Držiteľ v peňaženke stlačí „Preukázať sa overovateľovi“ a ukáže QR kód. Overovacia služba sa spojí priamo s peňaženkou na jeho telefóne, požiada o certifikát a overí ho v registroch EBSI a v kontrakte riadenia. Telefón musí byť v sieti, na ktorú služba dosiahne – v rovnakej Wi-Fi.':
    "The holder taps “Present to a verifier” in the wallet and shows a QR code. The Verifier Service connects straight to the wallet on their phone, asks for the certificate and checks it in EBSI's registries and the governance contract. The phone must be on a network the service reaches — the same Wi-Fi.",
  'Skenovať kamerou': 'Scan with the camera',
  'Zastaviť kameru': 'Stop the camera',
  'Nahrať obrázok QR kódu': 'Upload an image of the QR code',
  'Obsah QR kódu': 'What the QR code says',
  'Overuje sa…': 'Verifying…',
  'Pripojiť sa k peňaženke': 'Connect to the wallet',
  'Opačným smerom: držiteľ na karte „Licencie" stlačí':
    'The other way round: on the “Licenses” tab the holder taps',
  'Preukázať sa overovateľovi': 'Present to a verifier',
  ' a QR kód zo svojho telefónu ukáže kamere počítača alebo pošle jeho fotografiu. Telefón a back-office musia byť v rovnakej sieti.':
    " and shows the QR code on their phone to the computer's camera, or sends a photo of it. The phone and the back-office must be on the same network.",
  'Stav v kontrakte riadenia': 'Standing on the governance contract',
  Záznam: 'Record',
  'Naposledy zmenený': 'Last changed',
  'bez záznamu': 'no record',
  'Relácia vypršala. Prihláste sa znova.': 'Your session has expired. Please sign in again.',
  'Chyba ledgeru': 'Ledger error',
  'V prehliadači nie je peňaženka. Nainštalujte napríklad MetaMask a importujte do nej kľúč signatára.':
    "There is no wallet in the browser. Install MetaMask, for example, and import a signer's key into it.",
  'PLR Besu (lokálna sieť)': 'PLR Besu (local network)',
  'Neznámy úkon: {0}': 'Unknown action: {0}',
  'Peňaženka je na sieti {0}, kontrakt je na {1}.':
    'The wallet is on network {0}, the contract is on {1}.',
  navrhnutý: 'proposed',
  vykonaný: 'executed',
  vetovaný: 'vetoed',
  expirovaný: 'expired',
  'Tento signatár už návrh podpísal.': 'This signer has already signed the proposal.',
  'Návrh s týmto číslom na chaine neexistuje.': 'No proposal with this number exists on chain.',
  'Návrh už nie je otvorený — bol vykonaný, vetovaný alebo expiroval.':
    'The proposal is no longer open — it was executed, vetoed or has expired.',
  'Kvórum ešte nie je dosiahnuté, návrh sa nedá vykonať.':
    'The quorum has not been reached yet; the proposal cannot be executed.',
  'Návrh ešte neprekročil lehotu, nedá sa označiť za expirovaný.':
    'The proposal has not passed its deadline yet and cannot be marked as expired.',
  'Túto rolu z konzoly nemožno použiť. Orgán dohľadu hlasuje vlastnou peňaženkou.':
    'This role cannot be used from the console. The supervisory authority votes with its own wallet.',
  'Jeden človek môže dať za certifikačný orgán len jeden podpis — štvor-oký princíp. Podpísať musí niekto iný.':
    'One person can give only one signature on behalf of the certification body — the four-eyes principle. Someone else must sign.',
  'Prípad ešte neschválil druhý pracovník v back-office. Vykonať sa dá až potom.':
    'A second officer has not approved the case in the back-office yet. It can be executed only after that.',
  'Túto rolu nemáte pridelenú. Pridelí ju správca zaradením do skupiny plr_governance_a alebo plr_governance_b.':
    'You have not been assigned this role. An administrator assigns it by adding you to the group plr_governance_a or plr_governance_b.',
  'Táto adresa nie je platný signatár pre túto zmenu.':
    'This address is not a valid signer for this change.',
  'Táto adresa už je signatárom.': 'This address is already a signer.',
  'Back-office odmietol transakciu podpísať — nezodpovedala úkonu, ktorý schválil. Udalosť je v audit logu.':
    'The back-office refused to sign the transaction — it did not match the action it approved. The event is in the audit log.',
  'Na adrese {0} nie je kontrakt riadenia registra. Skontrolujte adresu kontraktu v stavovom riadku.':
    'There is no registry governance contract at {0}. Check the contract address in the status bar.',
  'Na zadanej adrese nie je kontrakt riadenia registra. Skontrolujte adresu kontraktu v stavovom riadku.':
    'There is no registry governance contract at this address. Check the contract address in the status bar.',
  'back-office alebo ledger je nedostupný. Hlas sa nezaznamenal — skúste to znova.':
    'The back-office or the ledger is unavailable. The vote was not recorded — please try again.',
  'Transakciu ste v peňaženke zamietli.': 'You rejected the transaction in your wallet.',
  // The trust chain and the certificate scheme (accreditation and schema feature modules; design decisions D15, D16).
  Akreditácia: 'Accreditation',
  'Reťazec dôvery: RootTAO vyberá TAO, TAO vyberá TI, ktoré smú vydávať certifikáty.':
    'The trust chain: the RootTAO selects TAOs, a TAO selects the TIs that may issue certificates.',
  'Reťazec dôvery': 'Trust chain',
  Ste: 'You are',
  'Vyberáte TAO; každý TAO potom vyberá TI — organizácie, ktoré smú vydávať certifikáty.':
    'You select TAOs; each TAO then selects TIs — the organisations that may issue certificates.',
  'Vyberáte TI — organizácie, ktoré smú vydávať certifikáty z aplikácie alebo z back-office.':
    'You select TIs — the organisations that may issue certificates from the app or from the back office.',
  'Tento účet nie je registrovaný za RootTAO ani TAO v reťazci dôvery.':
    'This account is not registered for the RootTAO or a TAO in the trust chain.',
  'Kontaktný e-mail nie je platný.': 'The contact e-mail is not valid.',
  'Pozvánka pre {0} ({1}):': 'Invitation for {0} ({1}):',
  'Odovzdajte ju organizácii; zobrazí sa len teraz. S ňou sa zaregistruje v aplikácii (Pre organizácie → Registrovať) alebo na prihlasovacej stránke tejto konzoly.':
    "Hand it to the organisation; it is shown only now. With it, the organisation registers in the app (For organisations → Register) or on this console's sign-in page.",
  'Odovzdajte ju organizácii; zobrazí sa len teraz. S ňou sa zaregistruje na prihlasovacej stránke tejto konzoly.':
    "Hand it to the organisation; it is shown only now. With it, the organisation registers on this console's sign-in page.",
  'Vybrať TAO': 'Select a TAO',
  'Vybrať TI': 'Select a TI',
  'Názov organizácie': 'Organisation name',
  'Kontaktný e-mail (voliteľné)': 'Contact e-mail (optional)',
  'napr. Agentúra pre digitálne zručnosti': 'e.g. Digital Skills Agency',
  'napr. kontakt@organizacia.sk': 'e.g. contact@organisation.example',
  'Vyberá sa…': 'Selecting…',
  'Vybrať a vytvoriť pozvánku': 'Select and create an invitation',
  'Vybrané TAO a ich TI': 'Selected TAOs and their TIs',
  'Vybrané TI': 'Selected TIs',
  'Zatiaľ nikto.': 'Nobody yet.',
  Organizácia: 'Organisation',
  Kontakt: 'Contact',
  Vybral: 'Selected by',
  'Nová pozvánka': 'New invitation',
  registrovaná: 'registered',
  'v EBSI zatiaľ nie je nastavená ako vydavateľ': 'not set up as an issuer in EBSI yet',
  'pozvánka vypršala': 'invitation expired',
  'čaká na registráciu': 'awaiting registration',
  'pozvánka platí do': 'invitation valid until',
  'Každý výber, nová pozvánka aj registrácia sa zapíše do auditného záznamu. Pozvánka je jednorazová; register uchováva len jej odtlačok. TI vydáva pod jediným DID registra a rozozná sa podľa účtu a vydavateľa uvedeného v certifikáte.':
    "Every selection, new invitation and registration goes into the audit log. An invitation works once; the registry keeps only its digest. A TI issues under the registry's single DID and is told apart by its account and the issuer the certificate names.",
  'Organizácia {0} je registrovaná. Prihláste sa.':
    'The organisation {0} is registered. Please sign in.',
  'Registrácia organizácie s pozvánkou': 'Register an organisation with an invitation',
  'Spôsob prístupu': 'Access method',
  Registrácia: 'Registration',
  'Registrácia organizácie': 'Organisation registration',
  'Pre TAO, ktorý vybral RootTAO, a pre TI, ktorú vybral TAO. Zadajte pozvánku, ktorú ste od neho dostali, a zvoľte si prihlasovacie údaje.':
    'For a TAO the RootTAO selected, and a TI a TAO selected. Enter the invitation you received from them and choose your sign-in details.',
  Pozvánka: 'Invitation',
  'napr. XXXX-XXXX-XXXX': 'e.g. XXXX-XXXX-XXXX',
  'Používateľské meno': 'Username',
  'napr. organizacia': 'e.g. organisation',
  'Zopakujte heslo': 'Repeat the password',
  'Minimálne 15 znakov': 'At least 15 characters',
  'Zadajte heslo znova': 'Enter the password again',
  'Registruje sa…': 'Registering…',
  Registrovať: 'Register',
  'Späť na prihlásenie': 'Back to sign-in',
  'Pozvánka neplatí: je nesprávna, už použitá alebo vypršala. O novú požiadajte toho, kto vás vybral.':
    'The invitation is not valid: it is wrong, already used or expired. Ask whoever selected you for a new one.',
  'Toto používateľské meno je už obsadené.': 'This username is already taken.',
  'Heslo musí mať 15 až 128 znakov. Použite menej predvídateľné heslo alebo dlhšiu frázu z nesúvisiacich slov.':
    'Use 15 to 128 characters and choose a less predictable password or a longer phrase with unrelated words.',
  'Skontrolujte pozvánku a používateľské meno (písmená, číslice a znaky @.+-_).':
    'Check the invitation and the username (letters, digits and @.+-_).',
  'Heslá sa nezhodujú.': 'The passwords do not match.',
  'Certifikát nezodpovedá schéme. Skontrolujte vyznačené polia.':
    'The certificate does not fit the scheme. Check the highlighted fields.',
  'Vydávať môže len TI, ktorú vybral TAO. Tento účet nie je TI v reťazci dôvery.':
    'Only a TI selected by a TAO may issue. This account is not a TI in the trust chain.',
  '(voliteľné)': '(optional)',
  'Názov osvedčenia': 'Certificate title',
  'napr. Osvedčenie o absolvovaní školenia': 'e.g. Certificate of training completion',
  'Meno a priezvisko s titulmi': 'Name with titles',
  'napr. Ing. Janko Mrkvička, PhD.': 'e.g. Ing. Janko Mrkvička, PhD.',
  'Pracovné zaradenie': 'Job position',
  'napr. manažér kybernetickej bezpečnosti': 'e.g. cybersecurity manager',
  'Názov školenia': 'Training',
  'napr. Manažér kybernetickej bezpečnosti': 'e.g. Cybersecurity manager',
  'Školenie od': 'Training from',
  'Školenie do': 'Training until',
  'Počet školiacich dní': 'Training days',
  'napr. 5': 'e.g. 5',
  'Počet vyučovacích hodín': 'Teaching hours',
  'napr. 40': 'e.g. 40',
  'Znalostný štandard': 'Knowledge standard',
  'napr. vyhláška č. 492/2022 Z. z.': 'e.g. Regulation No. 492/2022 Coll.',
  'napr. 248': 'e.g. 248',
  'Miesto vydania': 'Place of issue',
  'napr. Bratislava': 'e.g. Bratislava',
  'Dátum vydania': 'Date of issue',
  'Vydavateľ osvedčenia': 'Issued by',
  'Podpísal (meno a funkcia)': 'Signed by (name and function)',
  'napr. prof. Ing. Ján Novák, PhD., dekan': 'e.g. prof. Ing. Ján Novák, PhD., dean',
  Financovanie: 'Funding',
  'napr. Plán obnovy a odolnosti SR, Komponent 17, Reforma č. 5':
    'e.g. Recovery and Resilience Plan of the SR, Component 17, Reform 5',
  'Registračné číslo': 'Registration number',
  Držiteľ: 'Holder',
  Školenie: 'Training',
  Osvedčenie: 'Certificate',
  // Certificate schemas (design decisions D17).
  Atribút: 'Attribute',
  'Atribút {0}': 'Attribute {0}',
  'Atribút {0} je neplatný.': 'Attribute {0} is not valid.',
  'Atribút {0} potrebuje slovenský názov.': 'Attribute {0} needs a Slovak name.',
  'Atribút „{1}“ mal v predchádzajúcej verzii iný typ. Typ sa meniť nemôže: certifikáty vydané skôr by schéme prestali zodpovedať.':
    'Attribute “{1}” had a different kind in the previous version. A kind cannot change: certificates issued earlier would no longer fit the schema.',
  'Atribút „{1}“ má neznámu sekciu.': 'Attribute “{1}” has an unknown section.',
  'Atribút „{1}“ má neznámy typ.': 'Attribute “{1}” has an unknown kind.',
  Atribúty: 'Attributes',
  'Celé číslo': 'Whole number',
  'Certifikačné schémy': 'Certificate schemas',
  'Druh certifikátu': 'Kind of certificate',
  'Druhy certifikátov a ich atribúty. Určuje ich RootTAO a registrujú sa v TSR.':
    'Kinds of certificate and their attributes. The RootTAO defines them and they are registered in the TSR.',
  Dátum: 'Date',
  'Identifikátor v TSR nie je platný.': 'The TSR identifier is not valid.',
  'Identifikátor, ktorý verzii {0} pridelil TSR': 'Identifier the TSR gave version {0}',
  'Každý výber, zmena schém, nová pozvánka aj registrácia sa zapíše do auditného záznamu. Pozvánka je jednorazová; register uchováva len jej odtlačok. Každá TI vydáva pod vlastným DID a vlastnými kľúčmi, stav jej certifikátov vedie kontrakt riadenia; v EBSI ju akredituje TAO, ktorý ju vybral.':
    'Every selection, change of schemas, new invitation and registration is written to the audit log. An invitation works once; the registry keeps only its digest. Each TI issues under its own DID and with its own keys, and the governance contract keeps the standing of its certificates; in EBSI it is accredited by the TAO that selected it.',
  'Kľúč atribútu {0} musí začínať malým písmenom a obsahovať len písmená a číslice, napr. holderName.':
    'The key of attribute {0} must start with a lower-case letter and contain only letters and digits, e.g. holderName.',
  'Kľúč „{1}“ je použitý dvakrát.': 'The key “{1}” is used twice.',
  'Kľúč „{1}“ je vyhradený.': 'The key “{1}” is reserved.',
  'Nová schéma': 'New schema',
  'Nová verzia schémy {0}': 'New version of the schema {0}',
  'Názov (anglicky)': 'Name (English)',
  'Názov (slovensky)': 'Name (Slovak)',
  'Názov vydavateľa môže byť len textový atribút.':
    "The issuer's name can only be a text attribute.",
  'Názov vydavateľa môže vypĺňať len jeden atribút.':
    "Only one attribute can hold the issuer's name.",
  Odstrániť: 'Remove',
  Organizácie: 'Organizations',
  'Posunúť nižšie': 'Move down',
  'Posunúť vyššie': 'Move up',
  'Potvrdiť registráciu': 'Confirm the registration',
  Povinný: 'Required',
  'Predvolená hodnota': 'Default value',
  'Predvolená hodnota atribútu „{1}“ nezodpovedá jeho typu.':
    'The default value of attribute “{1}” does not fit its kind.',
  'Pridať atribút': 'Add an attribute',
  'Príklad (anglicky)': 'Example (English)',
  'Príklad (slovensky)': 'Example (Slovak)',
  'Registrácia v TSR zlyhala. Návrh je uložený, skúste ho uložiť znova.':
    'Registration in the TSR failed. The proposal is saved; try saving it again.',
  'Reťazec dôvery: RootTAO vyberá TAO, TAO vyberá TI a prideľuje im schémy, ktoré smú vydávať.':
    'The trust chain: the RootTAO selects TAOs, a TAO selects TIs and gives them the schemas they may issue.',
  'RootTAO určuje, aké druhy certifikátov existujú a čo každý uvádza. TAO ich v Akreditácii prideľuje TI a TI vydáva len tie, ktoré dostala.':
    'The RootTAO decides which kinds of certificate exist and what each states. A TAO gives them to TIs in Accreditation, and a TI issues only the ones it was given.',
  Schéma: 'Schema',
  'Schéma je vyradená; nová verzia sa už nedá pridať.':
    'The schema is retired; no new version can be added.',
  'Schéma môže mať najviac 40 atribútov.': 'A schema can have at most 40 attributes.',
  'Schéma odobratá TAO sa odoberie aj jeho TI.':
    'A schema taken from a TAO is taken from its TIs too.',
  'Schéma potrebuje aspoň jeden atribút.': 'A schema needs at least one attribute.',
  'Schéma {0} je vyradená.': 'The schema {0} is retired.',
  'Schéma {0} je zaregistrovaná v TSR, verzia {1}. Teraz ju môžete v Akreditácii prideliť TAO.':
    'The schema {0} is registered in the TSR, version {1}. You can now give it to TAOs in Accreditation.',
  'Schému v EBSI registruje Support Office na základe návrhu (komponent 7). Kým ju TSR neposkytuje, nedá sa podľa nej vydávať.':
    'In EBSI the Support Office registers a schema on a proposal (component 7). Until the TSR serves it, nothing can be issued under it.',
  Schémy: 'Schemas',
  'Schémy pre {0}': 'Schemas for {0}',
  'Schémy určuje len RootTAO.': 'Only the RootTAO defines schemas.',
  'Schémy, ktoré TAO smie prideľovať': 'Schemas the TAO may give out',
  'Schémy, ktoré TI smie vydávať': 'Schemas the TI may issue',
  Sekcia: 'Section',
  Skryť: 'Hide',
  'TSR schému s týmto identifikátorom neposkytuje.':
    'The TSR serves no schema with this identifier.',
  'Tento typ je vyhradený pre EBSI.': 'This type is reserved for EBSI.',
  Text: 'Text',
  Typ: 'Kind',
  'Typ certifikátu': 'Credential type',
  'Typ certifikátu je jeho identifikátor v každom certifikáte a v TSR; neskôr sa meniť nedá.':
    'The credential type identifies the schema in every certificate and in the TSR; it cannot be changed later.',
  'Typ certifikátu musí začínať veľkým písmenom a obsahovať len písmená a číslice, napr. DataProtectionOfficerCertificate.':
    'The credential type must start with a capital letter and contain only letters and digits, e.g. DataProtectionOfficerCertificate.',
  'Táto verzia už je zaregistrovaná.': 'This version is already registered.',
  'Ukladá sa…': 'Saving…',
  'Uložiť a zaregistrovať v TSR': 'Save and register in the TSR',
  'Uložiť návrh pre TSR': 'Save the proposal for the TSR',
  'Uložiť schémy': 'Save the schemas',
  Upraviť: 'Edit',
  'Vaša TI nie je akreditovaná na vydávanie tejto schémy. Pridelí vám ju váš TAO.':
    'Your TI is not accredited to issue this schema. Your TAO can give it to you.',
  'Vaša organizácia zatiaľ nesmie vydávať žiadnu schému certifikátu. Pridelí vám ju váš TAO v back-office.':
    'Your organization may not issue any certificate schema yet. Your TAO gives you schemas in the back-office.',
  Verzia: 'Version',
  'Verzia {0}': 'Version {0}',
  'Verzia {0} schémy {1} je uložená a čaká na registráciu v TSR.':
    'Version {0} of the schema {1} is saved and awaits registration in the TSR.',
  'Vypĺňa sa názvom vydávajúcej TI': "Filled with the issuing TI's name",
  Vyradiť: 'Retire',
  'Vyradiť schému {0}?': 'Retire schema {0}?',
  'Vyradiť schému': 'Retire schema',
  'Vyraďuje sa…': 'Retiring…',
  'Podľa tejto schémy už nebude možné vydávať nové certifikáty.':
    'New certificates can no longer be issued under this schema.',
  'Doteraz vydané certifikáty zostanú platné.': 'Certificates issued so far will remain valid.',
  'Vývojové prostredie: schéma sa hneď zaregistruje v TSR mocku a akreditácie registra sa rozšíria tak, aby ju pokrývali.':
    "Development environment: the schema is registered in the mock TSR at once, and the registry's accreditations are widened to cover it.",
  'Zadajte slovenský názov schémy.': "Enter the schema's Slovak name.",
  'Zatiaľ nemáte žiadnu schému, ktorú by ste mohli prideliť.':
    'You have no schema to give out yet.',
  'Zmena vytvorí verziu {0}. Doteraz vydané certifikáty zostávajú pod svojou verziou; typ atribútu sa medzi verziami meniť nemôže.':
    "The change creates version {0}. Certificates issued so far keep their version; an attribute's kind cannot change between versions.",
  Zrušiť: 'Cancel',
  'bez schém': 'no schemas',
  'navrhnutá {0}, čaká na registráciu v TSR': 'proposed {0}, awaiting registration in the TSR',
  'verzia {0}': 'version {0}',
  'verzia {0} čaká na registráciu v TSR': 'version {0} awaits registration in the TSR',
  vydavateľ: 'issuer',
  vyradená: 'retired',
  zaregistrovaná: 'registered',
  'zaregistrovaná v TSR': 'registered in the TSR',

  // Governance contract v2: roles and policies (design decisions D19).
  'zmena pravidiel': 'rule change',
  'Zmena pravidiel platí.': 'The rule change is in force.',
  'Zmena pravidiel je vetovaná a uzavretá.': 'The rule change is vetoed and closed.',
  '{0} z {1} rolí': '{0} of {1} roles',
  'vrátane {0}': 'including {0}',
  'Rola {0} nemá podľa pravidla právo veta; stiahnuť návrh môže len kľúč, ktorý ho otvoril.':
    'Role {0} may not veto under the rule; only the key that opened a proposal may withdraw it.',
  'veto {0}': 'veto {0}',
  'časový zámok {0} h': 'timelock {0} h',
  'bez časového zámku': 'no timelock',
  pravidlá: 'rules',
  '{0} dní': '{0} days',
  'verzia pravidiel': 'rules version',
  'Podpisy sa agregujú priamo na chaine, takže každý je samostatne a časovo overiteľný (komponent 10.4). Kvórum počíta roly, nie kľúče; hviezdička označuje rolu, ktorej podpis pravidlo vyžaduje.':
    'Signatures are aggregated on-chain, so each one is attributable and timestamped on its own (component 10.4). The quorum counts roles, not keys; an asterisk marks a role whose signature the rule requires.',
  'Doplňte prah a časový zámok.': 'Fill in the threshold and the timelock.',
  'Zvoľte aspoň jednu rolu s právom veta.': 'Choose at least one role that may veto.',
  'Zadajte adresu nového kľúča.': "Enter the new key's address.",
  'Zvoľte kľúč.': 'Choose a key.',
  'Zvoľte kľúč, ktorý sa vymení.': 'Choose the key to replace.',
  'Zadajte platnosť v dňoch.': 'Enter the validity in days.',
  'Certifikačný orgán môže túto zmenu navrhnúť sám.':
    'The certification body may propose this change on its own.',
  'Zmena uvoľňuje pravidlá ({0}). Ako orgán dohľadu ju môžete otvoriť; certifikačný orgán sa pripojí podpisom po vás.':
    'The change loosens the rules ({0}). As the supervisory authority you may open it; the certification body co-signs after you.',
  'Orgán dohľadu už podpísal ({0}), certifikačný orgán sa môže pripojiť.':
    'The supervisory authority has signed ({0}); the certification body may co-sign.',
  'Otvoriť ju môže len orgán dohľadu — {0}. Certifikačný orgán sa pripojí podpisom až po ňom.':
    'Only the supervisory authority can open it — {0}. The certification body co-signs only after it has.',
  'Vetovať zmenu pravidiel #{0}?': 'Veto rule change #{0}?',
  'Vetovať zmenu': 'Veto change',
  'Veto jedného oprávneného signatára zmenu pravidiel okamžite uzavrie.':
    'A veto from one authorized signer closes the rule change immediately.',
  'Rovnakú zmenu pravidiel možno neskôr navrhnúť znova.':
    'The same rule change can be proposed again later.',
  'pridať kľúč {0} pre rolu {1}': 'add key {0} for role {1}',
  'odobrať kľúč {0}': 'remove key {0}',
  'vymeniť kľúč {0} za {1}': 'replace key {0} with {1}',
  'platnosť návrhov {0} dní': 'proposals valid for {0} days',
  'Zmeniť pravidlo rozhodovania': 'Change a decision rule',
  'Vymeniť kľúč (rotácia)': 'Replace a key (rotation)',
  'Pridať kľúč': 'Add a key',
  'Odobrať kľúč': 'Remove a key',
  'Zmeniť platnosť návrhov': 'Change how long proposals stay open',
  Pre: 'For',
  Prah: 'Threshold',
  ' (všetky)': ' (all)',
  'Časový zámok (h)': 'Timelock (h)',
  'Nový kľúč': 'New key',
  'Adresa nového kľúča': "New key's address",
  Rola: 'Role',
  'Platnosť návrhu (dni)': 'Proposal validity (days)',
  'Povinné roly': 'Required roles',
  'Právo veta': 'May veto',
  'Kľúč nemôže vetovať vlastné odobratie ani výmenu.':
    'A key cannot veto its own removal or replacement.',
  'Ak má zmena pravidiel časový zámok, po dosiahnutí kvóra čaká a vetovať ju môže signatár roly s právom veta alebo ten, kto ju navrhol — okrem kľúča, ktorý sa odoberá alebo vymieňa. Pri vykonaní sa kvórum overuje znova podľa platných pravidiel a počítajú sa len podpisy kľúčov, ktoré sú stále signatármi; odobratý kľúč sa signatárom už nestane. Kvórum, ktoré sa stratí a znova obnoví podpisom, spustí časový zámok odznova. Štvor-oký princíp v back-office ostáva dvaja ľudia bez ohľadu na pravidlá na chaine — je to iná kontrola (komponent 10.4).':
    'When rule changes have a timelock, a change waits after reaching quorum and may be vetoed by a signer whose role may veto, or withdrawn by whoever proposed it — except by the key it removes or replaces. At execution the quorum is checked again under the rules then in force, and only signatures of keys that are still signers count; a removed key never becomes a signer again. A quorum that is lost and regained by a signature starts the timelock over. The four-eyes principle in the back-office stays at two people whatever the rules on chain — it is a different control (component 10.4).',
  'povinná rola': 'required role',
  'Podpisy kľúčov, ktoré už nie sú signatármi; kvórum ich nepočíta.':
    'Signatures of keys that are no longer signers; the quorum does not count them.',
  '+ bývalé kľúče: {0}': '+ former keys: {0}',
  'Pre tento certifikát už je na chaine otvorený iný návrh.':
    'Another proposal for this certificate is already open on chain.',
  'Časový zámok ešte platí. Vykonať sa dá až po jeho uplynutí.':
    'The timelock is still running. It can be executed only once it has elapsed.',
  'Neznáma rola.': 'Unknown role.',
  'Takéto pravidlo sa nedá splniť — povinných rolí je viac než prah, alebo rola nemá žiadny kľúč.':
    'Such a rule cannot be met — more roles are required than the threshold counts, or a role holds no key.',
  'Platnosť návrhu je mimo rozsahu, ktorý kontrakt pripúšťa.':
    'The proposal validity is outside the range the contract allows.',
  'Bez tohto kľúča by sa niektoré pravidlo už nedalo splniť.':
    'Without this key some rule could no longer be met.',
  'Kľúč nemôže vetovať vlastné odobratie ani výmenu — inak by kompromitovaný kľúč zablokoval rotáciu (komponent 10.9).':
    'A key cannot veto its own removal or replacement — otherwise a compromised key would block rotation (component 10.9).',
  'Rola tohto kľúča nemá podľa pravidla právo veta. Stiahnuť návrh môže len kľúč, ktorý ho otvoril.':
    "This key's role may not veto under the rule. Only the key that opened a proposal may withdraw it.",
  'Tento kľúč už signatárom bol a bol odobratý alebo vymenený; znova pridať ho nemožno. Použite nový kľúč.':
    'This key was a signer once and was removed or replaced; it cannot be added again. Use a new key.',
  'Prah pod 2 by znamenal, že rozhoduje jediná rola.':
    'A threshold below 2 would let a single role decide.',
  'Prah nemôže byť vyšší než počet rolí, ktoré majú kľúč.':
    'The threshold cannot exceed the number of roles that hold a key.',
  'Povinná rola nemá žiadny kľúč — každé také rozhodnutie by sa zablokovalo.':
    'A required role holds no key — every such decision would be blocked.',
  'Právo veta musí mať aspoň jedna rola s kľúčom — časový zámok, ktorý nikto nemôže prerušiť, nechráni pred ničím (komponent 10.4).':
    'At least one role that holds a key must be able to veto — a timelock nobody can interrupt protects against nothing (component 10.4).',
  'Túto zmenu pravidiel môže otvoriť len orgán dohľadu a certifikačný orgán sa k nej pripojí až po jeho podpise.':
    'Only the supervisory authority can open this rule change, and the certification body co-signs only after it has signed.',
  'Časový zámok je mimo povoleného rozsahu: trvalé odňatie 24 – 48 h (komponent 10.4), pozastavenie a obnovenie bez časového zámku.':
    'The timelock is outside the allowed range: 24 – 48 h for permanent revocation (component 10.4), none for suspension and reinstatement.',
  'Platnosť návrhu je mimo rozsahu, ktorý back-office podpíše.':
    'The proposal validity is outside the range the back-office will sign.',
  'Posledný kľúč orgánu dohľadu kľúčmi certifikačného orgánu odobrať nemožno.':
    "The certification body's keys cannot remove the supervisory authority's last key.",
  'Takúto zmenu back-office neponúka.': 'The back-office does not offer such a change.',
  'nižší prah uvoľňuje multisig': 'a lower threshold loosens the multisig',
  'rola, ktorá prestane byť povinná, uvoľňuje multisig':
    'a role no longer required loosens the multisig',
  'kratší časový zámok oslabuje ochranu pred unáhleným rozhodnutím':
    'a shorter timelock weakens the protection against a rash decision',
  'rola, ktorá stratí právo veta, oslabuje ochranu pred unáhleným alebo kompromitovaným rozhodnutím':
    'a role that loses the veto weakens the protection against a rash or compromised decision',
  'jednomyseľnosť robí každú rolu nenahraditeľnou — stratou jej kľúčov sa rozhodovanie zablokuje':
    'unanimity makes every role irreplaceable — losing its keys blocks decisions',
  'nový kľúč je nová cesta ku kvóru': 'a new key is a new way to reach quorum',
  'odobratie kľúča mení, kto môže dosiahnuť kvórum': 'removing a key changes who can reach quorum',
  'kľúč orgánu dohľadu rotuje orgán dohľadu': 'the supervisory authority rotates its own key',

  // A status change's reason (design decisions D22) and a TI's accreditation end (D23).
  'bez uvedenia dôvodu': 'no reason given',
  'kompromitácia kľúča alebo peňaženky držiteľa': "the holder's key or wallet was compromised",
  'na žiadosť držiteľa': "at the holder's request",
  'chyba pri vydaní': 'issued in error',
  'nahradený novým certifikátom': 'superseded by a new certificate',
  'držiteľ prestal spĺňať podmienky': 'the holder no longer meets the conditions',
  'rozhodnutie orgánu dohľadu': 'decision of the supervisory authority',
  'prebieha prešetrovanie': 'under investigation',
  'dôvod pozastavenia pominul': 'the reason for the suspension no longer applies',
  'iný dôvod': 'other reason',
  'TI sa vyberá s dátumom, do ktorého je akreditovaný.':
    'A TI is selected with the date until which it is accredited.',
  'Dátum konca akreditácie nie je platný.': 'The accreditation end date is not valid.',
  'Akreditácia nemôže skončiť v minulosti — ukončiť ju môžete hneď.':
    'An accreditation cannot end in the past — you can end it now instead.',
  'Na tak dlho naraz akreditáciu udeliť nemožno (najviac {0} dní).':
    'An accreditation cannot be granted for that long at once (at most {0} days).',
  'Akreditácia už skončila.': 'The accreditation has already ended.',
  'Akreditáciu TI predlžuje alebo ukončuje TAO, ktorý ho vybral.':
    "A TI's accreditation is extended or ended by the TAO that selected it.",
  'akreditácia bez obmedzenia': 'accreditation without an end',
  'akreditácia skončila': 'accreditation ended',
  'nové certifikáty nevydá; vydané predtým platia ďalej':
    'issues no new certificates; those issued before stay valid',
  'akreditácia skončí o {0} dní': 'accreditation ends in {0} days',
  'akreditácia platí do': 'accredited until',
  'Ukončiť akreditáciu pre {0}?': 'End accreditation for {0}?',
  'Ukončiť akreditáciu': 'End accreditation',
  'Ukončuje sa…': 'Ending…',
  'Organizácia okamžite stratí možnosť vydávať nové certifikáty.':
    'The organization will immediately lose the ability to issue new certificates.',
  'Už vydané certifikáty zostanú platné do konca svojej platnosti. Akreditáciu môžete neskôr obnoviť novým dátumom.':
    'Certificates already issued will remain valid until their expiry. You can renew the accreditation later with a new date.',
  'Akreditácia TI platí do {0}.': 'The TI is accredited until {0}.',
  'Akreditácia platí do': 'Accredited until',
  'Nový koniec akreditácie pre {0}': 'New accreditation end for {0}',
  'Predĺžiť, skrátiť alebo po skončení obnoviť. Certifikáty, ktoré TI vydal počas akreditácie, platia do konca svojej platnosti bez ohľadu na to, kedy akreditácia skončí.':
    'Extend, shorten, or renew after it ended. Certificates the TI issued while accredited stay valid until their own expiry, whenever the accreditation ends.',
  'Uložiť dátum': 'Save date',
  'Ukončiť teraz': 'End now',
  'Akreditácia TI má koniec, ktorý určuje jeho TAO a môže ho predĺžiť alebo akreditáciu ukončiť. Po konci TI nevydá nový certifikát; tie, ktoré vydal počas akreditácie, ostávajú platné do konca svojej platnosti (design decisions D23).':
    "A TI's accreditation has an end, set by its TAO, which may extend it or end the accreditation. After the end the TI issues no new certificates; those it issued while accredited stay valid until their own expiry (design decisions D23).",
  'Sprístupniť dôvod návrhu #{0}?': 'Disclose the reason for proposal #{0}?',
  'Zobrazí sa kategória dôvodu, interná poznámka a kryptografická soľ.':
    'The reason category, internal note, and cryptographic salt will be shown.',
  'Na chaine je dôvod návrhu len ako solený commitment. Audítor získa z back-office kategóriu, poznámku a soľ a kontrakt z nich commitment prepočíta (design decisions D22).':
    "On chain a proposal's reason is only a salted commitment. The auditor obtains the category, the note and the salt from the back-office, and the contract recomputes the commitment from them (design decisions D22).",
  'Dôvod návrhu': 'Proposal reason',
  'Overiť dôvod': 'Verify the reason',
  dôvod: 'reason',
  poznámka: 'note',
  'Zhoda — návrh na chaine bol otvorený práve s týmto dôvodom.':
    'Match — the on-chain proposal was opened with exactly this reason.',
  'Nezhoda — tento dôvod nezodpovedá commitmentu v návrhu.':
    "Mismatch — this reason does not match the proposal's commitment.",
  'Každé sprístupnenie je v audit logu ako': 'Every disclosure is in the audit log as',
  '— bez poznámky a soli.': '— without the note or the salt.',
  'Akreditácia vašej organizácie skončila {0}. Nové certifikáty vydávať nemôžete; certifikáty, ktoré ste vydali počas akreditácie, ostávajú platné do konca svojej platnosti. Obnovenie udeľuje váš TAO.':
    "Your organization's accreditation ended on {0}. You cannot issue new certificates; the certificates you issued while accredited stay valid until their own expiry. Your TAO grants a renewal.",
  'Akreditácia vašej organizácie skončí {0} (o {1} dní). O predĺženie požiadajte svoj TAO.':
    "Your organization's accreditation ends on {0} (in {1} days). Ask your TAO to extend it.",
  'Akreditácia vašej organizácie platí do {0}.': 'Your organization is accredited until {0}.',
  'Pozastavenie nastane hneď, na rozhodnutie jedného človeka (komponent 10.6) — pre nahlásené kompromitovanie kľúča. Je vratné; trvalé odňatie potom potrebuje riadne schválenie.':
    "The suspension takes effect at once, on one person's decision (component 10.6) — for a reported key compromise. It is reversible; a permanent revocation afterwards needs the regular approval.",
  'Poznámka (povinná)': 'Note (required)',
  'Poznámka (voliteľná)': 'Note (optional)',
  'napr. číslo rozhodnutia alebo spisu': 'e.g. a decision or case number',
  'Pozastaviť teraz': 'Suspend now',
  Navrhnúť: 'Propose',
  'Dôvod a poznámka ostávajú v back-office. Na chain ide s návrhom len ich solený commitment — dôvod je tak pevne daný už pri otvorení návrhu a audítor ho vie overiť, no z ledgeru sa nedá vyčítať (komponent 10.3).':
    'The reason and the note stay in the back-office. Only their salted commitment goes on chain with the proposal — so the reason is fixed when the proposal is opened and an auditor can verify it, but it cannot be read from the ledger (component 10.3).',
  'Certifikačný orgán (TI)': 'Certification body (TI)',
  'Nezistený — certifikát bol vydaný pred evidenciou TI, jeho akreditácia sa preto neposudzuje.':
    'Unknown — the certificate was issued before TIs were recorded, so its accreditation is not judged.',
  Vydal: 'Issued',
  'Akreditácia pri vydaní': 'Accreditation at issuance',
  platila: 'in force',
  neplatila: 'not in force',
  'do {0}': 'until {0}',
  Dnes: 'Today',
  'akreditácia skončila {0} — certifikáty vydané počas nej platia do konca svojej platnosti':
    'the accreditation ended on {0} — certificates issued while it was in force stay valid until their own expiry',
  'dôvod zapečatený': 'reason sealed',
  'bez dôvodu': 'no reason',
  // Revoking an organization's accreditation (design decisions D24).
  'organizácia prestala spĺňať podmienky akreditácie':
    'the organization no longer meets the accreditation conditions',
  'porušenie povinností akreditovanej organizácie':
    "breach of the accredited organization's obligations",
  'na žiadosť organizácie': "at the organization's request",
  'zánik organizácie': 'the organization ceased to exist',
  'akreditácia TI, ktorý ho vydal, bola odňatá':
    'the accreditation of the TI that issued it was revoked',
  'bez oprávnenia': 'no authority',
  'akreditácia {0} ({1}) bola odňatá {2}': 'the accreditation of {0} ({1}) was revoked on {2}',
  'akreditácia odňatá': 'accreditation revoked',
  'jeho TI stratili oprávnenie a ich certifikáty boli stiahnuté':
    'its TIs lost their authority and their certificates were withdrawn',
  'jeho certifikáty boli stiahnuté': 'its certificates were withdrawn',
  'Odňať akreditáciu — {0}': 'Revoke accreditation — {0}',
  'TAO stratí akreditáciu natrvalo a s ním aj všetky TI, ktoré vybral. Ich účty sa už neprihlásia a každý certifikát, ktorý tieto TI vydali, sa hneď pozastaví a navrhne na odňatie (to ešte schváli druhá osoba a kvórum na ledgeri).':
    'The TAO loses its accreditation for good, and with it every TI it selected. Their accounts can no longer sign in, and every certificate those TIs issued is suspended at once and proposed for revocation (which a second person and the on-chain quorum still approve).',
  'TI stratí akreditáciu natrvalo. Jeho účet sa už neprihlási — ani v aplikácii — a každý certifikát, ktorý vydal, sa hneď pozastaví a navrhne na odňatie (to ešte schváli druhá osoba a kvórum na ledgeri).':
    'The TI loses its accreditation for good. Its account can no longer sign in — not in the app either — and every certificate it issued is suspended at once and proposed for revocation (which a second person and the on-chain quorum still approve).',
  'Rozumiem, že odňatie je nevratné: akreditáciu nemožno obnoviť, organizáciu možno len vybrať nanovo.':
    'I understand that revocation cannot be undone: the accreditation cannot be restored, the organization can only be selected anew.',
  'Odníma sa…': 'Revoking…',
  'Odňať akreditáciu': 'Revoke accreditation',
  'Akreditácia organizácie {0} bola odňatá. Pozastavených certifikátov: {1}; navrhnutých na odňatie: {2} — schváli ich druhá osoba v Životnom cykle.':
    'The accreditation of {0} was revoked. Certificates suspended: {1}; proposed for revocation: {2} — a second person approves them in Lifecycle.',
  'Odňatie akreditácie je iné: je natrvalo, účty organizácie (a pri TAO aj jeho TI) sa už neprihlásia a všetky ich certifikáty sa stiahnu — hneď sa pozastavia a navrhnú na odňatie (design decisions D24).':
    "Revoking an accreditation is different: it is for good, the organization's accounts (and for a TAO, its TIs' too) can no longer sign in, and all their certificates are withdrawn — suspended at once and proposed for revocation (design decisions D24).",
  'akreditácia {0} ({1}) bola odňatá {2} — certifikáty, ktoré TI vydal, sú stiahnuté':
    'the accreditation of {0} ({1}) was revoked on {2} — the certificates the TI issued are withdrawn',
  'DID TI': "TI's DID",
  'Číslo certifikátu': 'Certificate number',
  Zapísaný: 'Recorded',
  'zdieľané údaje zodpovedajú tomu, čo vydavateľ podpísal':
    'what was shared matches what the issuer signed',
  'záznam certifikátu v kontrakte riadenia je dostupný':
    "the certificate's record on the governance contract is available",
  'záznam v kontrakte patrí tomuto certifikátu (TI, číslo, id, platnosť)':
    "the contract's record is this certificate's (TI, number, id, validity)",
  'kontrakt vedie certifikát ako platný': 'the contract records the certificate as valid',
  '. Stav certifikátu je len jeho záznam v kontrakte riadenia; status listy sa nepoužívajú (D36).':
    ". A certificate's standing is its record on the governance contract alone; there are no status lists (D36).",
  // What awaits the user at sign-in.
  Pozastavenie: 'Suspension',
  Odňatie: 'Revocation',
  Obnovenie: 'Reinstatement',
  Zavrieť: 'Close',
  'čaká na vaše schválenie': 'awaits your approval',
  'hlasovanie na chaine #{0}': 'vote on chain #{0}',
  'čaká na druhého schvaľovateľa': 'awaits a second approver',
  'Na vaše schválenie čakajú žiadosti o zmenu stavu certifikátov: {0}':
    "Requests to change a certificate's status awaiting your approval: {0}",
  'Otvorené žiadosti o zmenu stavu certifikátov: {0}':
    "Open requests to change a certificate's status: {0}",
  'navrhol {0}, {1}': 'proposed by {0}, {1}',
  '…a ďalšie: {0}. Všetky sú v Životnom cykle.': '…and {0} more. All of them are in Lifecycle.',
  'Obnova hesla': 'Password recovery',
  'Správa skupín': 'Group administration',
  Administrácia: 'Administration',
  'Súčasné heslo': 'Current password',
  'Nemáte oprávnenie spravovať účty alebo skupiny.':
    'You do not have permission to manage accounts or groups.',
  'Zoznam skupín': 'Group list',
  'Nová skupina': 'New group',
  'Názov skupiny': 'Group name',
  'Hľadať skupinu': 'Search groups',
  'Počet skupín': 'Group count',
  'Uložiť skupinu': 'Save group',
  'Vymazať skupinu': 'Delete group',
  'Vymazať účet': 'Delete account',
  'Potvrdiť vymazanie': 'Confirm deletion',
  'Naozaj vymazať túto skupinu?': 'Delete this group?',
  'Naozaj vymazať tento účet?': 'Delete this account?',
  'Skupinu sa nepodarilo uložiť.': 'The group could not be saved.',
  'Skupinu sa nepodarilo vymazať.': 'The group could not be deleted.',
  'Účet sa nepodarilo vymazať.': 'The account could not be deleted.',
  Meno: 'First name',
  Priezvisko: 'Last name',
  Oprávnenia: 'Permissions',
  Skupiny: 'Groups',
  Superuser: 'Superuser',
  'Nový účet': 'New account',
  'Správa účtov': 'Account administration',
  'Zoznam účtov': 'Account list',
  'Aktívny účet': 'Active account',
  'Prístup do administrácie': 'Administration access',
  'Priame oprávnenia': 'Direct permissions',
  'Uložiť účet': 'Save account',
  'Hľadať účet': 'Search accounts',
  Hľadať: 'Search',
  'Počet účtov': 'Account count',
  'Predchádzajúca strana': 'Previous page',
  'Ďalšia strana': 'Next page',
  Áno: 'Yes',
  Nie: 'No',
  'Dátum vytvorenia': 'Date joined',
  'Posledné prihlásenie': 'Last login',
  'Späť do konzoly': 'Back to the console',
  'Nechajte prázdne, ak sa heslo nemení.': 'Leave empty to keep the existing password.',
  'Účet bol zmenený. Prihláste sa znova.': 'Your account was changed. Sign in again.',
  'Účet bol uložený.': 'The account was saved.',
  'Účet sa nepodarilo uložiť.': 'The account could not be saved.',
  'Administrácia nie je dostupná.': 'Administration is unavailable.',
  'Nemáte oprávnenie vytvoriť účet.': 'You do not have permission to create an account.',
  'Spracúvam…': 'Processing…',
  'E-mail': 'Email',
  'Nové heslo': 'New password',
  'Potvrďte nové heslo': 'Confirm the new password',
  'Heslo bolo zmenené. Prihláste sa novým heslom.':
    'Your password was changed. Sign in with the new password.',
  'Ak je účet oprávnený na obnovu, dostanete e-mail s odkazom.':
    'If the account is eligible for recovery, you will receive an email with a link.',
  'Overujem odkaz…': 'Checking the link…',
  'Zmeniť heslo': 'Change password',
  'Odoslať odkaz': 'Send the link',
  'Obnova hesla sa nepodarila.': 'Password recovery failed.',
  'Odkaz na obnovu hesla je neplatný alebo vypršal.':
    'The password recovery link is invalid or expired.',
  // Per-TI governance, the certificate registry and its record keys.
  'Auditný záznam, ukotvené rozhodnutia a overenie návrhov na chaine.':
    'Audit log, anchored decisions and verification of on-chain proposals.',
  schválený: 'approved',
  'Tento účet nie je signatárom kontraktu pre túto TI.':
    'This account is not a signer of the contract for this TI.',
  'Register certifikátov tento certifikát nepozná — záznam vzniká až po vyzdvihnutí licencie.':
    'The certificate registry does not know this certificate — its record is created only once the licence is collected.',
  'Certifikát vydala iná TI.': 'Another TI issued the certificate.',
  'Odňatý certifikát zostáva odňatý.': 'A revoked certificate stays revoked.',
  'Táto TI nie je v kontrakte nastavená.': 'This TI is not set up on the contract.',
  'Akreditácia TI v registri dôveryhodných vydavateľov nie je platná — TI nemôže navrhovať ani vykonávať.':
    "The TI's accreditation in the Trusted Issuers Registry is not valid — the TI can neither propose nor execute.",
  'Kľúč nie je platným kľúčom DID v registri DID.':
    'The key is not a valid key of the DID in the DID Registry.',
  'Kľúč záznamu v registri certifikátov': 'Record key in the certificate registry',
  'Certifikát má jeden záznam a jeden kľúč pre všetky návrhy — pozastavenie, odňatie aj obnovenie — z TI, ktorá ho vydala, a identifikátora vyzdvihnutej licencie.':
    'A certificate has one record and one key for all its proposals — suspension, revocation and reinstatement — from the TI that issued it and the identifier of the collected licence.',
  'Získať identifikátor licencie': 'Get the licence identifier',
  '— licencia ešte nebola vyzdvihnutá': '— the licence has not been collected yet',
  'Nezhoda — návrh na chaine sa týka iného záznamu.':
    'Mismatch — the on-chain proposal concerns a different record.',
  'Kľúč vypočíta register certifikátov, teda rovnaká cesta, akú by použil nezávislý audítor. Každé sprístupnenie je v audit logu ako':
    'The certificate registry computes the key — the same path an independent auditor would use. Every disclosure is in the audit log as',
  'Sprístupniť identifikátor licencie?': 'Disclose the licence identifier?',
  'Kto pozná DID vydavateľa a identifikátor licencie, dokáže spojiť návrh na chaine s týmto certifikátom.':
    "Whoever knows the issuer's DID and the licence identifier can link the on-chain proposal to this certificate.",
  'Audítor získa z back-office DID vydavateľa a identifikátor vyzdvihnutej licencie, nechá register certifikátov vypočítať kľúč záznamu a porovná ho s návrhom na chaine (komponent 10.7). Výpočet robí kontrakt, teda rovnaká cesta, akú by použil nezávislý audítor.':
    "The auditor gets the issuer's DID and the collected licence's identifier from the back-office, has the certificate registry compute the record key and compares it with the on-chain proposal (component 10.7). The contract does the computation — the same path an independent auditor would use.",
  'Identifikátor licencie': 'Licence identifier',
  'napr. urn:uuid:…': 'e.g. urn:uuid:…',
  'Overiť kľúč záznamu': 'Verify the record key',
  'Identifikátor licencie pozná len ten, komu ju držiteľ ukázal, a back-office; kľúč záznamu z neho vypočíta ktokoľvek. Verejný uzol vidí, na čo sa ho pýtate — tam, kde na tom záleží, počítajte kľúč lokálne.':
    'Only those the holder showed the licence to, and the back-office, know its identifier; anyone can compute the record key from it. A public node sees what you ask it — where that matters, compute the key locally.',
  'Žiadna TI ešte nemá v kontrakte nastavených signatárov a pravidlá. Nastaví ich TAO po akreditácii TI.':
    'No TI has signers and rules set up on the contract yet. The TAO sets them up after accrediting the TI.',
  spolupodpisovatelia: 'cosigners',
  'ktorýkoľvek platný kľúč tohto DID': 'any valid key of this DID',
  'Na chaine je výhradne kľúč záznamu certifikátu, solený commitment dôvodu a neosobné metadáta — žiadne meno, číslo licencie, DID držiteľa ani čitateľný dôvod (komponent 10.3). Kľúč sa nedá spätne prepočítať bez identifikátora licencie, ktorý pozná len držiteľ, ten, komu ju ukázal, a back-office. Dôvod je pevne daný pod každým podpisom a audítor ho overí v záložke Audit. Kľúč záznamu zobrazí podržanie myši nad číslom návrhu.':
    "On chain there is only the certificate's record key, the reason's salted commitment and non-personal metadata — no name, licence number, holder DID or readable reason (component 10.3). The key cannot be traced back without the licence identifier, which only the holder, those they showed the licence to, and the back-office know. The reason is fixed under every signature, and an auditor verifies it in the Audit tab. Hover over a proposal's number to see its record key.",
  'V prehliadači nie je peňaženka. Nainštalujte napríklad MetaMask a importujte do nej kľúč signatára — pre lokálnu sieť je kľúčom DID orgánu dohľadu vývojový účet č. 5 z':
    "There is no wallet in the browser. Install MetaMask, for example, and import a signer's key into it — for the local network, the key of the supervisory authority's DID is development account no. 5 in",
  'Musí to byť platný kľúč DID tejto TI v registri DID.':
    "It must be a valid key of this TI's DID in the DID Registry.",
  'Každá TI má v kontrakte vlastné kľúče a pravidlá. Každý kľúč patrí jednej role — A a B sú kľúče DID samotnej TI, C podpisuje ktorýkoľvek platný kľúč DID orgánu dohľadu — a kvórum počíta roly, nie kľúče. Každý druh rozhodnutia má vlastné pravidlo: koľko rolí, ktoré z nich povinne, ktoré môžu vetovať a aký časový zámok. Pravidlá mení kontrakt vlastným kvórom podľa pravidla zmeny pravidiel (komponent 10.4).':
    "Each TI has its own keys and rules on the contract. Every key holds one role — A and B are keys of the TI's own DID, and any valid key of the supervisory authority's DID signs as C — and the quorum counts roles, not keys. Each kind of decision has its own rule: how many roles, which of them are required, which may veto, and what timelock. The contract changes its rules through its own quorum, under the rule for rule changes (component 10.4).",
  'Pravidlo pre kľúče certifikačného orgánu: sprísniť multisig môže sám, uvoľniť ho alebo zmeniť signatárov len po podpise orgánu dohľadu — ten istý princíp ako pri vete, kde je zastavenie ľahké a rozhodnutie ťažké. Vlastné kľúče (A, B) môže vymeniť sám. Kľúče orgánu dohľadu sú v jeho vlastnom DID a mení ich len on; spolupodpisovateľov TI nastavuje TAO. Nikdy nie pod 2 roly. Jeden človek dá za certifikačný orgán najviac jeden podpis na jednu zmenu.':
    "The rule for the certification body's keys: it may make the multisig stricter on its own, but loosen it or change the signers only after the supervisory authority has signed — the same principle as the veto, where stopping is easy and deciding is hard. It may replace its own keys (A, B) on its own. The supervisory authority's keys are in its own DID and only it changes them; the TAO sets a TI's cosigners. Never below 2 roles. One person gives at most one of the certification body's signatures per change.",
  'Certifikát s týmto číslom ste už vydali. Každý certifikát TI má vlastné číslo.':
    'You have already issued a certificate with this number. Every certificate of a TI has its own number.',
  'Certifikát potrebuje číslo.': 'The certificate needs a number.',
  'Zaregistruje certifikát s jeho atribútmi pod číslom, ktoré mu TI dáva — každé číslo raz — a vráti ponuku OpenID4VCI pre peňaženku držiteľa (komponent 5). Keď si ho držiteľ vyzdvihne, zapíše sa do registra certifikátov.':
    "Registers the certificate with its attributes under the number the TI gives it — each number once — and returns an OpenID4VCI offer for the holder's wallet (component 5). When the holder collects it, it is recorded in the certificate registry.",
  'a záznam v registri certifikátov ho uvádza (komponent 1.1).':
    'and the record in the certificate registry states it (component 1.1).',
  'Jediný zdroj pravdy o certifikáte: jeho záznam v registri certifikátov — TI, platnosť, odtlačok licencie a stav. Overovateľ ho nájde z licencie, ktorú mu držiteľ ukáže, bez back-office.':
    "The only source of truth about the certificate: its record in the certificate registry — TI, validity, the licence's fingerprint and standing. A verifier finds it from the licence the holder shows them, without the back-office.",
  'Záznam v registri certifikátov': 'Record in the certificate registry',
  'Záznam vznikne, keď si držiteľ licenciu vyzdvihne — pod kľúčom z DID TI a identifikátora vyzdvihnutej licencie. Jeho stav potom ukazuje Životný cyklus a audítor ho overí v záložke Audit.':
    "The record is created when the holder collects the licence — under a key from the TI's DID and the collected licence's identifier. Lifecycle then shows its standing, and an auditor verifies it in the Audit tab.",
  'a záznam v registri certifikátov ho uvádza (komponent 1.1). Záznam vzniká, keď si držiteľ licenciu vyzdvihne. Identifikátor vyzdvihnutej licencie sa tu nezobrazuje — spája návrhy na chaine s certifikátom (komponent 1.2). Nová ponuka zruší predchádzajúcu a má vlastný PIN.':
    "and the record in the certificate registry states it (component 1.1). The record is created when the holder collects the licence. The collected licence's identifier is not shown here — it links the proposals on chain to the certificate (component 1.2). A new offer cancels the previous one and has its own PIN.",
};
