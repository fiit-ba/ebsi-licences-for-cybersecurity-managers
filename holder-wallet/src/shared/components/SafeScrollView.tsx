// A screen's ScrollView whose end clears the system's navigation bar. Android
// draws the app edge to edge, under the three buttons or the gesture bar; the
// tabs keep their screens above it, but a screen of the root stack ends where
// the display does, and on a small phone its last lines went under the bar.
import { ScrollView, ScrollViewProps, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const SafeScrollView = ({ contentContainerStyle, ...props }: ScrollViewProps) => {
  const { bottom } = useSafeAreaInsets()
  const own = StyleSheet.flatten(contentContainerStyle) ?? {}
  const padding =
    typeof own.paddingBottom === 'number' ? own.paddingBottom : typeof own.padding === 'number' ? own.padding : 0
  return <ScrollView {...props} contentContainerStyle={[contentContainerStyle, { paddingBottom: padding + bottom }]} />
}

export default SafeScrollView
