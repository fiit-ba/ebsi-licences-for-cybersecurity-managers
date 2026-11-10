# Wallet build and release

The Wallet is maintained as an Expo bare project. Its checked-in `ios/` and
`android/` directories are source code and must not be replaced with clean
`expo prebuild` output. Unless a command says otherwise, run it from
`holder-wallet/`.

## Toolchain

- Node.js 22.13 or newer in major versions 22–24 (`.nvmrc` pins 22.13.1)
- Yarn 1.22.x
- Expo SDK 57, React 19.2 and React Native 0.86 with Hermes and New Architecture
- iOS 16.4 or later; Xcode 26.6 / iOS 26 SDK; CocoaPods 1.16 or later
- Android JDK 17, compile/target SDK 36, Build Tools 36.0.0, AGP 8.12.0,
  Gradle 9.3.1, Kotlin 2.1.20 and NDK 27.1.12297006
- EAS CLI 16 or later when using EAS builds

## Install dependencies

```sh
cd holder-wallet
nvm use
yarn install --frozen-lockfile
```

`patch-package` applies the compatibility patches in `patches/` during install.
After changing native dependencies, update the iOS workspace:

```sh
cd ios
pod install
cd ..
```

## Configure the target environment

Create the Wallet environment file:

```sh
cp .env.example .env
```

This is `holder-wallet/.env`, which is compiled into the application. It is
different from `infra/.env`, which configures the server stack. Use the same
device-reachable DNS name or LAN address as `PLR_PUBLIC_HOST`:

```dotenv
NODE_IP=http://<shared-host>:8545
BACKOFFICE_URL=http://<shared-host>:8000
EBSI_URL=http://<shared-host>:8090
CERTIFICATE_REGISTRY=0xCertificateRegistryAddress
LEDGER_CHAIN_ID=1337
EBSI_SUPPORT_OFFICE_DID=did:ebsi:zSupport
```

A physical phone cannot use the host's `localhost`; Android `10.0.2.2` is only
for the emulator. Offers, metadata, audiences, callbacks and backup must retain
the same issuer origin. Rebuild the JavaScript bundle after changing these
build-time values.

The repository launcher normally creates this development configuration and
starts Metro:

```sh
cd ..
./start-mvp.sh
```

## Run a development build

If Metro is not already running, start it first:

```sh
yarn start
```

Then use a second terminal:

```sh
# Android emulator or connected device
yarn android --no-bundler

# iOS Simulator
yarn ios --no-bundler

# Connected iPhone
yarn ios --device --no-bundler
```

Omit `--no-bundler` when Expo should start Metro. Confirm Android devices with
`adb devices`. An iPhone needs Developer Mode and a Development Team for the
`atestwallet` target. In Xcode always open `ios/atestwallet.xcworkspace`, not the
`.xcodeproj`.

## Validate changes

Run the complete Wallet check:

```sh
yarn verify
```

For toolchain diagnosis or dependency compatibility, also run:

```sh
yarn doctor
yarn check:dependencies
```

After native dependency changes, build both native projects and rerun `pod install`.
Headless tests do not replace acceptance testing on a signed physical-device build.

## Android release artifacts

Create local artifacts with:

```sh
yarn build:android:apk
yarn build:android:aab
```

They are written to:

- `android/app/build/outputs/apk/release/app-release.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

The repository debug keystore is only for local installation. A pilot or store
candidate must use the protected command and a real upload key:

```sh
yarn build:android:production
```

That command rejects a debug upload key, cleartext HTTP endpoints and missing
operator terms. For a local release that must reach the HTTP development stack,
`./gradlew assembleRelease -PplrAllowCleartext=true` may be run in `android/`;
never enable that flag for production.

A release build is signed with the key that `ATEST_UPLOAD_STORE_FILE`,
`ATEST_UPLOAD_KEY_ALIAS`, `ATEST_UPLOAD_STORE_PASSWORD` and
`ATEST_UPLOAD_KEY_PASSWORD` name, from the environment or `android/local.properties`;
without them packaging stops ("missing required property storeFile"). For a local
build, point them at `android/app/debug.keystore` (alias `androiddebugkey`, both
passwords `android`). An update installs over a wallet only when it is signed
with the same key as the installed one: `adb install -r` then keeps the wallet's
keys and licences, while a different key makes Android refuse the update, and
uninstalling deletes the wallet. Building one ABI
(`-PreactNativeArchitectures=arm64-v8a` for a current phone) saves most of the
native build time.

Before Google Play submission, verify APK zip alignment, confirm that the AAB
reports `PAGE_ALIGNMENT_16K`, inspect native libraries for 16 KB ELF alignment,
and test on a 16 KB Android image.

## iOS archive and TestFlight

Open `ios/atestwallet.xcworkspace`, select the distribution team and choose
**Product → Archive**. Distribution requires the final bundle identifier,
certificates and provisioning profile. Development signing is not a production
release configuration.

The checked-in native project also supports the profiles in `eas.json`:

```sh
eas build --platform ios --profile development
eas build --platform ios --profile preview
eas build --platform ios --profile production
```

Before TestFlight, confirm that the production profile resolves to
`com.atestwallet.app` and the intended credentials. Install the candidate over
the previous version and verify that Keychain records, DIDs and credentials remain
readable.

## Embedded bundles only

These commands export JavaScript and assets into the native projects; they do not
produce an installable APK, AAB or iOS archive:

```sh
yarn build:android
yarn build:ios
```
