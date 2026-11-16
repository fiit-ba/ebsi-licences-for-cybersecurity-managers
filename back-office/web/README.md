# Operator console

The existing React console is owned by this package. It preserves its screens,
styles, fonts, translations, direct routes and consumed API contracts. Business
rights are enforced by the TypeScript backend on every request.

From `back-office/`, run `npm ci` and `npm run dev`. Vite proxies `/api-backend`
to `BACK_OFFICE_DEV_API_URL` (default `http://127.0.0.1:8000`) and `/api-ledger`
to `PLR_LEDGER_RPC_URL` (default `http://127.0.0.1:8545`). No browser opens automatically.
`npm run build:web` produces assets for the ordinary backend and hosted staff edge.
See [installation](../../docs/GUIDE.md) for bootstrap, keys and network settings.

App startup/shell live in `src/app`, workflows in `src/features`, public clients
and primitives in `src/shared`. Generated ledger ABI remains at
`src/blockchain/certificateGovernanceContract.ts`, owned by the contract exporter.
Issuer, lifecycle, verification, governance, accreditation/schema, audit and account
screens retain their existing routes. The governance screen shows one TI at a time:
its signers, cosigners, rules and proposals, read from the contract. Audit evidence and contract standing remain
independent of local registry state. Console API prefixes work in both built and
dev operation; Wallet/public protocols use direct issuer URLs.

The backend serves the console with a strict Content-Security-Policy:
`script-src` and `style-src` are `'self'`, and `img-src` is `'self' data:`. Nothing
may be inline: the loading skeleton shown before the app starts lives in
`public/preboot.js` and `public/preboot.css`, and a photo of a holder's QR code is
decoded straight from the file (`createImageBitmap`), never through a `blob:` URL.

The Verify tab works two ways. **Request:** it shows an OpenID4VP request as a QR
code and polls its result, which ends as the verification, as "declined" when the
holder refuses in the wallet (`access_denied`), or as "expired"; the spent QR code
is removed. **From the holder's phone:** the holder shows the wallet's own QR code
(camera, photo or pasted text) and the back office connects to the wallet over the
local network; an exchange QR code is valid for two minutes.
