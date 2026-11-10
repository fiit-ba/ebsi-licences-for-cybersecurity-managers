import styled from 'styled-components/native'
import { StyleSheet, View } from 'react-native'
// Keeps the custom overflow control centred in the native navigation header.
export const DropdownView = styled(View)`
	flex-direction: row;
	justify-content: flex-end;
`
// Centralizes the reusable visual contract for the overflow control and its
// grouped menu instead of coupling those styles to the component's behavior.
export const styles = StyleSheet.create({
  menuButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  menuButtonPressed: {
    backgroundColor: '#FFFFFF14',
  },
  glyphCanvas: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  closeLine: {
    position: 'absolute',
    width: 20,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  closeLineForward: {
    transform: [{ rotate: '45deg' }],
  },
  closeLineBackward: {
    transform: [{ rotate: '-45deg' }],
  },
  menuPosition: {
    marginTop: 8,
  },
  menuSurface: {
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  menuItem: {
    minHeight: 46,
  },
  menuItemContent: {
    paddingRight: 8,
  },
  menuItemTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  divider: {
    marginVertical: 5,
    marginHorizontal: 14,
  },
})
