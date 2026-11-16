// The top row of the setup screens - PIN, security phrase, its confirmation
// and derivation path. The screen's own action (back, sign in) is on the left,
// the SK | EN switch on the right, so the holder can change language at any
// step and not only on the first screen.
import React from 'react'
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import LanguageToggle from '@shared/components/LanguageToggle'

interface Props {
  /** The screen's back or sign-in button; nothing when it has none. */
  children?: React.ReactNode
  /** The spacing the screen's own button used to carry. */
  style?: StyleProp<ViewStyle>
}

const SetupTopBar = ({ children, style }: Props) => {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.row, { paddingTop: insets.top + 8 }, style]}>
      <View style={styles.start}>{children}</View>
      <LanguageToggle tone="onBackground" />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  start: {
    flex: 1,
    alignItems: 'flex-start',
  },
})

export default SetupTopBar
