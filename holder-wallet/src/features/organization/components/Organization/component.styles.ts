import { StyleSheet } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { CONTROL_HEIGHT, CONTROL_RADIUS, INPUT_HEIGHT } from '@shared/constants/ui'
// Shared organization form geometry, including an auto-growing read-only value.
export const styles = StyleSheet.create({
  field: { minHeight: INPUT_HEIGHT, marginTop: 10, backgroundColor: getThemeColor(ColorKeys.background) },
  fieldOutline: { borderRadius: CONTROL_RADIUS },
  content: { minHeight: INPUT_HEIGHT, fontFamily: FONT_FAMILY.PRINCIPAL },
  readOnlyPressable: { marginTop: 10 },
  readOnlyField: {
    minHeight: INPUT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: getThemeColor(ColorKeys.border),
    borderRadius: CONTROL_RADIUS,
    backgroundColor: getThemeColor(ColorKeys.orgSurface),
  },
  readOnlyText: { flex: 1, minWidth: 0 },
  readOnlyLabel: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 12,
    lineHeight: 16,
    color: getThemeColor(ColorKeys.mutedText),
  },
  readOnlyValue: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 16,
    lineHeight: 21,
    flexShrink: 1,
    color: getThemeColor(ColorKeys.text),
  },
  copyIcon: { marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
  button: { borderRadius: CONTROL_RADIUS, alignSelf: 'center' },
  buttonContent: { height: CONTROL_HEIGHT, width: 240, borderRadius: CONTROL_RADIUS },
  label: { fontFamily: FONT_FAMILY.PRINCIPAL, fontWeight: '600', fontSize: 15, letterSpacing: 0.2 },
})
