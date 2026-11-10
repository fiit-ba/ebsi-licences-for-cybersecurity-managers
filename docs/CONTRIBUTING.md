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

For support, include the platform, toolchain versions, command or user action,
expected result, actual result and a minimal reproduction. Remove account
passwords, bearer tokens, recovery phrases, private keys and credential contents
from logs and screenshots.

Do not report security vulnerabilities in public issues or discussions. Use the
repository's private vulnerability-reporting channel or contact the maintainers
directly. Include only the minimum data needed to reproduce the problem and never
send production secrets or personal credential data.
