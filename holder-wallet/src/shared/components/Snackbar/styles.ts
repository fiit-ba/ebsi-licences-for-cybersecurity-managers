import { StyleSheet } from 'react-native'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
// A compact floating card replaces the old solid-colour rounded rectangle.
export const styles = StyleSheet.create({
  wrapper: {
    bottom: 84,
    zIndex: 10000,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: 8,
  },
  snackbar: {
    minHeight: 56,
    margin: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
  },
  content: {
    marginHorizontal: 0,
    marginVertical: 0,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBackground: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  message: {
    flex: 1,
    flexShrink: 1,
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
})
