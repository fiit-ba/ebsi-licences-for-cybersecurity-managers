# Contributing, support and security

Keep changes focused, add tests for behavior changes and explain both the problem
and the chosen solution. Run the relevant checks before opening a pull request:

```sh
# Back Office, from back-office/
npm run check:standalone
npm run typecheck
npm test

# Wallet, from holder-wallet/
yarn verify
```

Use the component-specific validation described in
[back-office validation](../back-office/docs/validation.md) and
[Wallet build and release](WALLET_BUILD.md) when changing providers, contracts or
native dependencies. Contributions to the Wallet are provided under its
[MIT License](../holder-wallet/LICENSE.md).

When a change adds, removes or updates a dependency, a vendored file, a native
library or a container image, run `node sbom/generate.mjs` from the repository
root, with that part's dependencies installed, and commit the updated
[third-party component lists](../sbom/README.md). CI checks that they are
current. When the generator reports a component without a licence, or the review
table in `sbom/README.md` shows a licence that is not in SPDX form, add the
component to `licenseOverrides` in `sbom/components.json` with the reason.

For support, include the platform, toolchain versions, command or user action,
expected result, actual result and a minimal reproduction. Remove account
passwords, bearer tokens, recovery phrases, private keys and credential contents
from logs and screenshots.

Do not report security vulnerabilities in public issues or discussions. Use the
repository's private vulnerability-reporting channel or contact the maintainers
directly. Include only the minimum data needed to reproduce the problem and never
send production secrets or personal credential data.
