import { StyleSheet } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

export const screenStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: getThemeColor(ColorKeys.background) },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 20, paddingBottom: 40 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  waitingText: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 15,
    fontWeight: '600',
    color: getThemeColor(ColorKeys.text),
    marginLeft: 10,
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
    marginTop: 16,
    overflow: 'hidden',
  },
  primary: { alignSelf: 'center', marginTop: 24 },
})
