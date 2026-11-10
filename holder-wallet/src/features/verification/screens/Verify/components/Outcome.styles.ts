import { StyleSheet } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

export const outcomeTextColor = getThemeColor(ColorKeys.text)
export const outcomeMutedColor = getThemeColor(ColorKeys.mutedText)

export const outcomeStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: getThemeColor(ColorKeys.surface),
    borderLeftWidth: 5,
    borderRadius: 12,
    padding: 14,
  },
  bannerText: { marginLeft: 14, flex: 1 },
  headline: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 22, fontWeight: '700' },
  code: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 12, letterSpacing: 0.6, color: outcomeMutedColor, marginTop: 2 },
  body: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 15, lineHeight: 21, color: outcomeTextColor, marginTop: 12 },
  types: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 15, fontWeight: '600', color: outcomeTextColor, marginTop: 10 },
  muted: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 13, lineHeight: 18, color: outcomeMutedColor, marginTop: 6 },
  card: { backgroundColor: getThemeColor(ColorKeys.surface), borderRadius: 12, padding: 14, marginTop: 16 },
  cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 16,
    fontWeight: '700',
    color: outcomeTextColor,
    marginBottom: 4,
  },
  badge: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 13, fontWeight: '700' },
  sectionTitle: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: outcomeMutedColor,
    marginBottom: 6,
  },
  row: { marginTop: 6 },
  rowLabel: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 13, color: outcomeMutedColor },
  rowValue: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 15, color: outcomeTextColor, marginTop: 1 },
  mono: { fontSize: 13 },
  divider: { height: 1, backgroundColor: getThemeColor(ColorKeys.border), marginVertical: 12 },
  toggle: { marginTop: 10, alignSelf: 'flex-start' },
  condition: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  mark: { width: 24, fontSize: 16, fontWeight: '700' },
  conditionLabel: { flex: 1, fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 14, lineHeight: 20, color: outcomeTextColor },
})
