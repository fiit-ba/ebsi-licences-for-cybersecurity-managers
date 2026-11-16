import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs'
import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RootStackScreenProps, RootTabParamList } from '@app/navigation/types'
import { TabAccentContext } from '@shared/components/TabBarIcon'
import { compactBottomInset } from './navigation.constants'
import { createScreenOptions, createTabOptions } from './navigation.styles'
import { useActiveProfileTabs } from './useActiveProfileTabs'
import { useNavigationHeader } from './useNavigationHeader'
import { wrapTabScreen } from './wrapTabScreen'

const Tab = createMaterialTopTabNavigator<RootTabParamList>()

function BottomTabNavigator({ navigation, route }: RootStackScreenProps<'Root'>) {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const { screens, initialTab, accent, headerBackground } = useActiveProfileTabs()
  const { focusTab } = useNavigationHeader({
    navigation,
    route,
    screens,
    initialTab,
    headerBackground,
  })
  const bottomInset = compactBottomInset(insets.bottom)

  return (
    <TabAccentContext.Provider value={accent}>
      <Tab.Navigator
        initialRouteName={initialTab}
        initialLayout={{ width: window.width, height: window.height }}
        tabBarPosition="bottom"
        screenListeners={({ route: tabRoute }) => ({
          focus: () => focusTab(tabRoute.name),
        })}
        screenOptions={createScreenOptions(accent, bottomInset)}
      >
        {screens.map((screen) => (
          <Tab.Screen
            {...screen}
            component={wrapTabScreen(screen.component)}
            key={screen.name}
            options={() => createTabOptions(screen.options, accent, window.width)}
          />
        ))}
      </Tab.Navigator>
    </TabAccentContext.Provider>
  )
}

export default BottomTabNavigator
