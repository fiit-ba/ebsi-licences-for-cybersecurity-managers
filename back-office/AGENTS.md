# Back Office implementation conventions

Use TypeScript for application code, scripts and checks. The current backend lives
in `server/`, the operator console in `web/`, public contracts in `shared/`, and
ordered SQL migrations in `data/migrations/`. Read current architecture,
configuration and validation documentation before changing those responsibilities.

Preserve existing product workflows, API/data contracts, routes, visual design and
business rights. Do not add contract semantics, states or quorum rules as structural
cleanup. A fresh installation starts with an empty PostgreSQL and local initial
administrator bootstrap; accounts and recovery tokens belong to that installation. Preserve existing development data and unrelated resources.

Business roles, human four-eyes checks and governance signer membership remain
separate. Keep KMS purposes distinct, uncertain signed bytes pinned, historical DID
lookup precise and required audit immutable. Real EBSI writes remain manual. Current
security boundaries and provider limitations are recorded in `docs/architecture.md`;
preserve them during maintenance. Use the main-console/API workflows for domain operations; account and group
administration have their own permission checks.

Group modules/tests by domain. Colocate `*.test.ts` with implementations, shared test
helpers in domain `fixtures/`, and browser scenarios in `web/tests/`. Browser code
must not import server implementations. Import owning files directly; avoid barrels,
empty layers and unnecessary nesting. Generated contract ABI remains owned by
`contracts/scripts/export-abi.js` in current shared/browser outputs.

Document exported functions, service operations and nontrivial functions with TSDoc:
behavior, inputs, returned value and caller-visible errors. Use `@remarks` for retry,
transaction, lifecycle or security constraints. Give named types/interfaces one
short description. Keep logical steps on separate lines, with blank lines between
phases, and review documentation semantically rather than relying only on structure.

Run `npm run format:check`, `npm run check:docs`, `npm run typecheck`, `npm run build:web`
and relevant server/Wallet/browser/contract checks. Each full server suite uses a
NEW disposable PostgreSQL database; never reset a working DB or clear immutable audit
for test isolation. Ordinary product builds, tests and startup must use current packages and
explicit fixtures, with no dependency on archive files, Git history or source fetching.
