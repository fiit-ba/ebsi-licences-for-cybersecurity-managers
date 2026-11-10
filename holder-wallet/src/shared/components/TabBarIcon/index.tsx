import { MaterialCommunityIcons } from '@expo/vector-icons'
import { createContext, useContext, type ComponentProps, type ReactElement } from 'react'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

export const TabAccentContext = createContext<string | null>(null)

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']

interface TabBarIconProps {
  focused?: boolean
  name: IconName
  selectedName?: IconName
}

export default function TabBarIcon({ focused, name, selectedName = name }: TabBarIconProps): ReactElement {
  const accent = useContext(TabAccentContext) ?? getThemeColor(ColorKeys.primary)

  return (
    <MaterialCommunityIcons
      accessibilityElementsHidden
      color={focused ? accent : getThemeColor(ColorKeys.tabIconDefault)}
      importantForAccessibility="no-hide-descendants"
      name={focused ? selectedName : name}
      size={25}
    />
  )
}
