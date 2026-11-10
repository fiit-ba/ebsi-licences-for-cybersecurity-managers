import type { ComponentProps } from 'react'
import type { MaterialCommunityIcons } from '@expo/vector-icons'
import { SCREEN } from '@shared/constants/screens'

export type MenuIcon = ComponentProps<typeof MaterialCommunityIcons>['name']
export type HeaderMenuRoute = typeof SCREEN.DidList | typeof SCREEN.Login | typeof SCREEN.OnBoarding
type HeaderMenuCommand = 'SwitchRole' | 'TermsAndConditions' | 'Language'

export type HeaderMenuItem = {
  title: HeaderMenuRoute | HeaderMenuCommand
  i18nKey: string
  icon: MenuIcon
  dividerBefore?: boolean
  destructive?: boolean
}
