# Atest Wallet

Atest Wallet is the mobile holder application for the Professional Licence
Registry. It stores holder keys and credentials on the device and supports
EBSI/OpenID credential issuance, presentation, verification and encrypted backup.

Build and device instructions are in [Wallet build and release](WALLET_BUILD.md).

## Create or recover a Wallet

Create a Wallet and record its BIP-39 recovery phrase privately. The identity
path is derived deterministically from the phrase, so the same phrase recreates
the same identity keys. The local PIN protects access to the installed Wallet.
Never share the recovery phrase, PIN, private keys or decrypted backup contents.

Recovery derives identity and backup keys locally. If an encrypted backup exists
at the configured Back Office, the Wallet downloads, decrypts and merges it on
the device. A phrase cannot recover data that was never backed up. A successful
headless backup test does not certify Keychain or operating-system backup behavior
on a physical device.

## Identity and organization access

The identity screens manage DIDs for configured network adapters. EBSI issuer and
verifier endpoints belong to the selected deployment. Alastria and LACChain
adapters have separate network configuration; their presence does not certify a
deployment or conformance program.

Organization sign-in uses a Back Office account and its current roles. Removing
an account role or revoking its organization can invalidate access. Holder
identity keys and organization account authentication are separate.

## Collect a credential

Scan the issuer's credential-offer QR code or open its offer link on the device,
then enter the offer PIN when requested. Following OpenID4VCI 1.0, the Wallet
resolves issuer metadata, exchanges the pre-authorized code with the PIN as its
transaction code, takes a fresh nonce from the issuer's Nonce Endpoint, proves
possession of a holder key bound to this issuer and stores the credential after a
successful response. A wrong PIN is refused; after five wrong PINs the offer is
locked and the TI re-offers the licence with a new PIN. Collecting needs the back
office, which is the issuer: the offer, the PIN check and the signing of the
licence all happen there.

The issuer, subject, validity and disclosures are signed. After collection the
issuing TI records the credential on the certificate registry: its standing,
validity and the hash of the signed credential, under a key computed from the TI
and the credential's id. Until that record exists, the credential has no
confirmed status.

## Present and verify a credential

Scan or open the verifier request, review the requested information and select an
eligible credential. An OpenID4VP 1.0 request asks with a DCQL query, naming the
claims it requires and those it would also like; the Wallet shows which is which.
Approval sends the holder proof and permitted claims through that presentation or
the encrypted holder-exchange flow. Declining the request does not approve
disclosure, and the verifier is told at once (OpenID4VP `access_denied`) instead
of waiting for the request to expire; a dialog the wallet's lock closed is no refusal.

The phone verifies a licence too: the Overiť tab, or "Overiť licenciu bez
prihlásenia" on the sign-in screen without a wallet. It shows a request QR code
that the holder scans (answered through the verification service, with "declined"
shown if the holder refuses), or it scans the holder's own QR code
("Naskenovať QR kód držiteľa") and checks the licence itself, phone to phone.

Verification depends on signature, holder binding, schema, accreditation,
validity and the certificate's record: the Wallet's own verifier reads it from the
certificate registry and checks that it matches the credential shown. A local
presentation-history entry is not a contract transaction. Deleting local history
does not revoke a credential; suspension and revocation are the issuing TI's
decisions on the governance contract.

## Locking

Going to the background locks the wallet, on every screen: the PIN held for the
session is forgotten and the sign-in screen covers the tabs. The ⋮ menu and a
presentation request dialog close with it. A flow still running at that moment (a
link's presentation or issuance, a refresh, a restore) finishes without opening
the tabs; they open again only after the PIN. The issuance dialogs stay open, so
the holder can look the issuer's PIN up in another app; they show the issuer's
offer, nothing from the wallet.

## Without the back office

Unlocking, the licences and their details, the presentation and history lists,
DID management and presenting phone to phone ("Preukázať sa overovateľovi", over
the Wi-Fi) need no server. Verifying a licence the same way needs only EBSI's
registries and the ledger: the Verify screen offers "Naskenovať QR kód držiteľa"
at once, while it still reaches the verification service and when it cannot.
Requests that need the back office (issuance, OpenID4VP requests, backup, the
verification service) end with a message when it cannot be reached; on a network
that never answers, only after their timeout (30 seconds for the verification
service). "Aktualizovať licencie" says when a status could not be read; such a
licence keeps its last known status. An EBSI registry that cannot be read makes a
verification INDETERMINATE (it cannot be completed), never UNTRUSTED_ISSUER; a
ledger record that cannot be read makes it STATUS_UNAVAILABLE.

## Backup and device changes

Keep the recovery phrase independently of the phone. Confirm a successful backup
synchronization before replacing a device. Backups are opaque ciphertext to the
server and are authenticated with a dedicated signing key; restore and merge run
locally. Rehearse recovery on a separate test device or profile instead of
deleting a working installation.

## Source architecture

- `holder-wallet/src/app` — composition, navigation, localization and flow orchestration
- `holder-wallet/src/features` — screens and feature UI
- `holder-wallet/src/domain` — pure business rules and protocol-independent types
- `holder-wallet/src/infrastructure` — HTTP, OpenID, persistence, cryptography and native adapters
- `holder-wallet/src/shared` — reusable presentation components and utilities

Run `yarn architecture:check` in `holder-wallet/` after moving modules. Public API
payloads, OpenID endpoints, route names, persisted keys, backup schemas and
cryptographic formats have compatibility tests. The native application ID is
`com.atestwallet.app`.

## Brand and generated artwork

The application name is **Atest** and the Slovak tagline is “Odborné osvedčenia,
overiteľné kdekoľvek”. Brand constants are in
`holder-wallet/src/shared/constants/brand.ts`; native names are in `app.json` and
Android `strings.xml`.

The source artwork is under `holder-wallet/design/svg/`. The mark is an A whose
crossbar is a mint check. The colour palette is defined in
`holder-wallet/src/shared/constants/Colors.ts` and shared with React Native Paper.
Organization screens intentionally use their own purple tokens.

Inter 4.1 is bundled under the SIL Open Font License in
`holder-wallet/src/assets/fonts/Inter-LICENSE.txt`. Android maps its weights through
`android/app/src/main/res/font/inter.xml`; iOS loads the individual faces from the
application resources.

Regenerate every derived image from the repository root:

```sh
python3 holder-wallet/design/render.py
```

Chrome or Chromium is required. Set `CHROME=/path/to/binary` if it is not in a
standard location. The script writes application images, Expo icons, Android
launcher/splash resources and iOS asset-catalog images. Launcher and native splash
changes require a new native build; images under `src/assets` can change with the
JavaScript bundle.

## Maintenance boundaries

- Treat Alastria and LACChain as separate adapters and test their protocols and
  networks independently of the professional-licence EBSI deployment.
- Some native-library boundaries use broad types because their packages have
  incomplete declarations. Narrow them only with adapter and device coverage.
- Changes to the application ID, native targets or URL scheme require an in-place
  upgrade test with existing Keychain records, DIDs and credentials.
- Headless protocol tests and generated JavaScript bundles do not establish
  signed-binary, native-storage or physical-device acceptance.
- Keep production `TODO` and `FIXME` work documented in this section instead of
  leaving untracked markers in application source.

## Legal files

The Wallet uses the [MIT License](../holder-wallet/LICENSE.md). The exact package,
CocoaPods and Gradle dependency graphs determine applicable third-party terms;
review the [third-party notice entry point](../holder-wallet/THIRD_PARTY_NOTICES.md)
before distributing a binary.
