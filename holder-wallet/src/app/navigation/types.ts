import type { MaterialTopTabScreenProps } from '@react-navigation/material-top-tabs'
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export type RootStackParamList = {
  SplashScreen: undefined
  OnBoarding: undefined
  Login: { callback?: NavigationCallback; locked?: boolean } | undefined
  Register: undefined
  SecurityPhrase: { mneumonic: string; derivationPath: string } | undefined
  SecurityPhraseConfirm: { mneumonic: string; derivationPath: string } | undefined
  DerivationPath: { derivationPath: string } | undefined
  Root: NavigatorScreenParams<RootTabParamList> | undefined
  Modal: undefined
  QrReader: { issuer?: string }
  DidList: undefined
  Verify: undefined
  Organization: undefined
  Restore: undefined
  Present: undefined
  VerifyOffline: { invitation: string }
}

export type NavigationCallback = {
  id: string
  params: unknown[]
}

export type RootStackScreenProps<Screen extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Screen
>

export type RootTabParamList = {
  IssueTab: undefined
  Credentials: undefined
  VerifyTab: undefined
  Presentations: undefined
  Historical: undefined
}

export type RootTabScreenProps<Screen extends keyof RootTabParamList> = CompositeScreenProps<
  MaterialTopTabScreenProps<RootTabParamList, Screen>,
  NativeStackScreenProps<RootStackParamList>
>
