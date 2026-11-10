import { StyleSheet } from 'react-native'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
// Shared geometry for both content placement and the native-header variant.
// The latter omits its own frame because iOS supplies the outer glass capsule.
export const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: 999,
    padding: 2,
  },
  headerGroup: {
    width: 92,
    height: 44,
    padding: 3,
    borderWidth: 0,
  },
  option: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  headerOption: {
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  pressed: {
    opacity: 0.78,
  },
  label: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 0.4,
  },
})
