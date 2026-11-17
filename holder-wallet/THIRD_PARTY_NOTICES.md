# Third-party software

Atest Wallet uses third-party packages. Every one of them, with its version and
licence, is listed in [`sbom/holder-wallet.md`](../sbom/holder-wallet.md), and in
CycloneDX form in [`sbom/holder-wallet.cdx.json`](../sbom/holder-wallet.cdx.json).
That list covers:

- the npm packages in `yarn.lock`;
- the CocoaPods in `ios/Podfile.lock`;
- the native libraries fetched at build time outside npm (OpenSSL, libsodium, and
  the C++ libraries React Native prebuilds for iOS);
- the vendored Inter font (SIL Open Font License 1.1, with its licence text in
  `src/assets/fonts/Inter-LICENSE.txt`).

The Android libraries Gradle resolves from Maven at build time are not in the list;
[`sbom/README.md`](../sbom/README.md) explains how to list them.

Each package's metadata and included notice files remain the source of truth for
its terms. Before distributing a binary, review the notices included by the exact
release build.
