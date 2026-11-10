import { StyleSheet } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

export const screenStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: getThemeColor(ColorKeys.background) },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 20, paddingBottom: 40 },
  connecting: { marginTop: 40 },
  afterOffline: { marginTop: 24 },
  intro: { fontFamily: FONT_FAMILY.PRINCIPAL, fontSize: 15, lineHeight: 22, color: getThemeColor(ColorKeys.text) },
  qrCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 308,
    aspectRatio: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    marginTop: 20,
    borderWidth: 1,
    borderColor: getThemeColor(ColorKeys.border),
  },
  qr: { width: '100%', height: '100%' },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  waitingText: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 15,
    fontWeight: '600',
    color: getThemeColor(ColorKeys.text),
    marginLeft: 10,
  },
  muted: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 13,
    lineHeight: 18,
    color: getThemeColor(ColorKeys.mutedText),
    textAlign: 'center',
    marginTop: 10,
  },
  notice: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 15,
    lineHeight: 21,
    color: getThemeColor(ColorKeys.text),
    backgroundColor: getThemeColor(ColorKeys.surface),
    borderLeftWidth: 5,
    borderRadius: 12,
    padding: 14,
    overflow: 'hidden',
  },
  primary: { alignSelf: 'center', marginTop: 24 },
  secondary: { alignSelf: 'center', marginTop: 8 },
  offline: { alignSelf: 'center', marginBottom: 2 },
})
