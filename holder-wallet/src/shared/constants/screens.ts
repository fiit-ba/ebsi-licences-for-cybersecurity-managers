export const SCREEN = {
  SplashScreen: 'SplashScreen',
  OnBoarding: 'OnBoarding',
  Register: 'Register',
  Login: 'Login',
  SecurityPhrase: 'SecurityPhrase',
  SecurityPhraseConfirm: 'SecurityPhraseConfirm',
  DerivationPath: 'DerivationPath',
  // No NetworkAuth screen: the EBSI DID is created by the button that leads
  // on (shared/hooks/useEbsiDid.ts).
  DidList: 'DidList',
  QrReader: 'QrReader',
  Credentials: 'Credentials',
  Presentations: 'Presentations',
  Historical: 'Historical',
  // The verifier: this phone asks another to present a certificate
  // (component 6, design decisions D14). A screen of its own before
  // registration, and a tab of the bottom bar once signed in.
  Verify: 'Verify',
  VerifyTab: 'VerifyTab',
  // An organization: signing in or registering with an invitation, and the
  // tab it issues from (design decisions D15). Issue is also the strings' bundle.
  Organization: 'Organization',
  Issue: 'Issue',
  IssueTab: 'IssueTab',
  // Restoring a wallet from its security phrase (design decisions D31).
  Restore: 'Restore',
  // A certificate presented phone to phone, and verified without the server
  // (design decisions D33).
  Present: 'Present',
  VerifyOffline: 'VerifyOffline',
} as const
