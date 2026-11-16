import { useEffect, useRef } from 'react'
import { Route, getFocusedRouteNameFromRoute } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { RootStackScreenProps, RootTabParamList } from '@app/navigation/types'
import { TabScreenConfig } from '@shared/types/navigation'
import { resolveTabTitle } from './resolveTabTitle'

type NavigationHeaderOptions = {
  navigation: RootStackScreenProps<'Root'>['navigation']
  route: Partial<Route<string>>
  screens: TabScreenConfig[]
  initialTab: keyof RootTabParamList
  headerBackground: string
}

export const useNavigationHeader = ({
  navigation,
  route,
  screens,
  initialTab,
  headerBackground,
}: NavigationHeaderOptions) => {
  const { i18n } = useTranslation()
  const focusedTab = useRef<string | undefined>(undefined)

  const titleFor = (routeName: string) => resolveTabTitle(routeName, screens)

  useEffect(() => {
    const routeName = focusedTab.current ?? getFocusedRouteNameFromRoute(route) ?? initialTab
    navigation.setOptions({
      headerTitle: titleFor(routeName),
      headerStyle: { backgroundColor: headerBackground },
    })
  }, [navigation, route, i18n.language, screens, initialTab, headerBackground])

  const focusTab = (routeName: string) => {
    focusedTab.current = routeName
    navigation.setOptions({ headerTitle: titleFor(routeName) })
  }

  return { focusTab }
}
