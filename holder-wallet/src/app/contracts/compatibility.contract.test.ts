import fs from 'node:fs'
import path from 'node:path'

import { SCREEN } from '@shared/constants/screens'
import { STORAGE_KEYS } from '@infrastructure/storage'
import { HOLDER_KEYCHAIN_USERNAME, NO_KEYCHAIN_ERROR } from '@infrastructure/persistence/keychain/keychain.adapter'
import { ORGANIZATION_KEYCHAIN_SERVICE } from '@infrastructure/organization/organizationProfile.repository'
import { derivationPathFormats, derivationPathSeetingsDefault } from '@infrastructure/identity/hd-wallets/constants'
import { buildAuthorizationRequest } from '@infrastructure/openid/authorization.mapper'

const root = path.resolve(__dirname, '../../..')
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('backward-compatible application contracts', () => {
  test('keeps every public navigation route name', () => {
    expect(SCREEN).toEqual({
      SplashScreen: 'SplashScreen',
      OnBoarding: 'OnBoarding',
      Register: 'Register',
      Login: 'Login',
      SecurityPhrase: 'SecurityPhrase',
      SecurityPhraseConfirm: 'SecurityPhraseConfirm',
      DerivationPath: 'DerivationPath',
      DidList: 'DidList',
      QrReader: 'QrReader',
      Credentials: 'Credentials',
      Presentations: 'Presentations',
      Historical: 'Historical',
      Verify: 'Verify',
      VerifyTab: 'VerifyTab',
      Organization: 'Organization',
      Issue: 'Issue',
      IssueTab: 'IssueTab',
      Restore: 'Restore',
      Present: 'Present',
      VerifyOffline: 'VerifyOffline',
    })
  })

  test('keeps AsyncStorage and Keychain identifiers', () => {
    expect(STORAGE_KEYS).toEqual({
      PIN: 'pin',
      PRIVATE_KEY: 'privateKey',
      IS_WALLET_CREATED: 'isWalletCreated',
      IS_DID_CREATED: 'isDIDCreated',
      APP_WAS_INSTALLED: 'wasAppInstalled',
    })
    expect(HOLDER_KEYCHAIN_USERNAME).toBe('VaccinesData')
    expect(NO_KEYCHAIN_ERROR).toBe('No keychain stored')
    expect(ORGANIZATION_KEYCHAIN_SERVICE).toBe('plr.organization')
  })

  test('preserves HD-wallet persistence formats', () => {
    expect(derivationPathFormats).toMatchObject({
      MAIN_IDENTITY: 'mZRSSSSSW',
      NETWORK_DID: 'mMTN',
      INTERACTING_DID: 'mBB',
    })
    expect(derivationPathSeetingsDefault).toEqual({
      Z: '1037171',
      R: 'random',
      SSSSS: 'random',
      W: 'random',
      M: '131071',
      T: '0407',
      N: '100111001',
      B: 'random',
      BB: 'random',
    })
  })

  test('builds the OpenID4VCI 1.0 authorization request', () => {
    const payload = buildAuthorizationRequest(
      {
        issuerState: 'issuer-state',
        subjectDid: 'did:key:holder',
        challenge: 'pkce-challenge',
        credentialConfigurationId: 'ProfessionalLicence',
        locations: 'https://issuer.example',
        scope: ['openid', 'credential'],
      },
      'fixed-state',
    )
    expect(payload).toEqual({
      response_type: 'code',
      scope: 'openid credential',
      state: 'fixed-state',
      client_id: 'did:key:holder',
      authorization_details:
        '[{"type":"openid_credential","locations":["https://issuer.example"],"credential_configuration_id":"ProfessionalLicence"}]',
      client_metadata:
        '{"vp_formats_supported":{"jwt_vc_json":{"alg_values":["ES256"]}},"response_types_supported":["vp_token","id_token"],"authorization_endpoint":"openid4vp://"}',
      code_challenge: 'pkce-challenge',
      code_challenge_method: 'S256',
      nonce: 'glkFFoisdfEui4312',
      redirect_uri: 'openid://callback',
      issuer_state: 'issuer-state',
    })
  })

  test('keeps native application identifiers and deep-link schemes', () => {
    const app = JSON.parse(read('app.json')) as { expo: { scheme: string } }
    expect(app.expo.scheme).toBe('atest-backend-staging')

    const iosProject = read('ios/atestwallet.xcodeproj/project.pbxproj')
    expect(iosProject).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.atestwallet.app;')

    const infoPlist = read('ios/atestwallet/Info.plist')
    for (const scheme of ['openid-credential-offer', 'openid4vp', 'openid', 'atest-backend-staging']) {
      expect(infoPlist).toContain(`<string>${scheme}</string>`)
    }

    const androidBuild = read('android/app/build.gradle')
    expect(androidBuild).toContain("applicationId 'com.atestwallet.app'")
    const manifest = read('android/app/src/main/AndroidManifest.xml')
    expect(manifest).toContain('android:scheme="atest-backend-staging"')
    expect(manifest).toContain('android:scheme="openid4vp"')
  })
})
