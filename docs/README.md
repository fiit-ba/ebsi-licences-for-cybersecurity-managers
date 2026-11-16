# Documentation

This directory is the central entry point for product, development and deployment
documentation. Package-local READMEs are retained only where commands or
architecture belong to that independently maintained component.

## Start and operate Atest

- [Local installation, bootstrap and recovery](GUIDE.md)
- [Hosted installation](PRODUCTION.md)
- [Infrastructure overview](../infra/README.md)

## Atest Wallet

- [Holder workflows, architecture, design and maintenance](WALLET.md)
- [Development, native builds and releases](WALLET_BUILD.md)

The Wallet's `LICENSE.md` and `THIRD_PARTY_NOTICES.md` stay beside the package so
that every distributed copy retains its legal information.

## Back Office

- [Package overview](../back-office/README.md)
- [Architecture and security boundaries](../back-office/docs/architecture.md)
- [Account password policy](../back-office/docs/password-policy.md)
- [Runtime settings](../back-office/docs/configuration.md)
- [Background jobs and recovery](../back-office/docs/background.md)
- [Field encryption and key operations](../back-office/docs/field-encryption.md)
- [EBSI integration profiles](../back-office/docs/ebsi-profiles.md)
- [Validation commands and provider limits](../back-office/docs/validation.md)
- [Operator console development](../back-office/web/README.md)

## Other components

- [Contracts: certificate registry and governance](../contracts/README.md)
- [Development EBSI service (Core API v1)](../infra/ebsi-mock/README.md)
- [Contributing, support and security reporting](CONTRIBUTING.md)
