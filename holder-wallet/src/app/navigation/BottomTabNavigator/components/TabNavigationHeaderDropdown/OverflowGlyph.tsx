import { View } from 'react-native'
import { styles } from './style'

export const OverflowGlyph = ({ open }: { open: boolean }) => (
  <View style={styles.glyphCanvas} pointerEvents="none">
    {open ? (
      <>
        <View style={[styles.closeLine, styles.closeLineForward]} />
        <View style={[styles.closeLine, styles.closeLineBackward]} />
      </>
    ) : (
      <View style={styles.dotRow}>
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>
    )}
  </View>
)
