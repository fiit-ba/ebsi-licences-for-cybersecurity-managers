import { StyleSheet } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

export const screenStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: getThemeColor(ColorKeys.background) },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 20, paddingBottom: 40 },
  intro: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 15, lineHeight: 22, color: getThemeColor(ColorKeys.text) },
  card: { backgroundColor: getThemeColor(ColorKeys.orgSurface), borderRadius: 12, padding: 16, marginBottom: 6 },
  organization: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: getThemeColor(ColorKeys.orgPrimary),
    marginBottom: 6,
  },
  cardTitle: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 18,
    fontWeight: '700',
    color: getThemeColor(ColorKeys.text),
    marginBottom: 6,
  },
  segments: { marginTop: 18, marginBottom: 6 },
  error: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 14,
    lineHeight: 20,
    color: getThemeColor(ColorKeys.error),
    marginTop: 12,
  },
  submit: { marginTop: 22 },
  hint: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 13,
    lineHeight: 18,
    color: getThemeColor(ColorKeys.mutedText),
    textAlign: 'center',
    marginTop: 12,
  },
})
