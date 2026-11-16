import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import type { MaterialTopTabNavigationOptions } from '@react-navigation/material-top-tabs'
import { TAB_CONTENT_HEIGHT } from './navigation.constants'

export const createScreenOptions = (accent: string, bottomInset: number) => ({
  tabBarActiveTintColor: accent,
  tabBarInactiveTintColor: getThemeColor(ColorKeys.tabIconDefault),
  tabBarStyle: {
    height: TAB_CONTENT_HEIGHT + bottomInset,
    paddingBottom: bottomInset,
  },
  tabBarItemStyle: {
    height: TAB_CONTENT_HEIGHT,
    paddingTop: 4,
    paddingBottom: 2,
    paddingHorizontal: 2,
  },
})

export const createTabOptions = (
  options: MaterialTopTabNavigationOptions,
  accent: string,
  windowWidth: number,
): MaterialTopTabNavigationOptions => ({
  tabBarShowIcon: true,
  tabBarLabelStyle: {
    fontSize: windowWidth < 360 ? 10 : 12,
    textTransform: 'capitalize' as const,
    marginHorizontal: 0,
    marginBottom: 0,
    lineHeight: 16,
  },
  tabBarIndicatorStyle: {
    backgroundColor: accent,
    top: 0,
    height: 3,
  },
  ...options,
})
