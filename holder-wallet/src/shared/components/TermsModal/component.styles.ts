import styled from 'styled-components/native'
import { safeStyledText } from '@shared/components/atomic_components/Text'
// The page title's variant and the plain text style, for the paragraphs.
import TextStyled from '@shared/components/atomic_components/Text'
import { Title } from '@shared/components/atomic_components/Text/variants'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
// The terms are a full-screen sheet, like the wallet's other modals.
// They were a floating card whose background never applied - a missing
// semicolon after background-color voided it - over a transparent modal, so
// the text was drawn straight over the registration screen and its "Start"
// button, and could not be read. The sheet is opaque, the text is set in
// paragraphs rather than justified with the source's indentation, and the
// button sits in its own bar below the text instead of being pulled up
// over it.
// The shared modal frame applies the native safe-area insets.
export const ModalView = styled.View`
  flex: 1;
  background-color: ${getThemeColor(ColorKeys.background)};
`
// The title and, for the operator's terms, their version.
export const TitleBlock = styled.View`
  flex: 1;
  margin-right: 12px;
`
// A title bar, with the language switch beside the title.
export const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px 24px;
  border-bottom-width: 1px;
  border-bottom-color: ${getThemeColor(ColorKeys.border)};
`
// The title in the text colour, on one line where it fits.
export const ModalTitle = safeStyledText(Title)`
	font-size: 20px;
	line-height: 26px;
	color: ${getThemeColor(ColorKeys.text)};
`
// The version of the operator's terms, under the title.
export const Version = safeStyledText(TextStyled)`
	margin-top: 2px;
	font-size: 13px;
	color: ${getThemeColor(ColorKeys.mutedText)};
`
// The text scrolls between the title bar and the button bar.
export const TextContainer = styled.ScrollView.attrs({
  contentContainerStyle: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
})`
  flex: 1;
`
// Left-aligned paragraphs at a reading size and line height.
export const ModalText = safeStyledText(TextStyled)`
	font-size: 15px;
	line-height: 23px;
	margin-bottom: 14px;
	color: ${getThemeColor(ColorKeys.text)};
`
// A list item: the bullet and its text, with a hanging indent.
export const BulletRow = styled.View`
  flex-direction: row;
  padding-left: 4px;
`
// The list item's bullet.
export const Bullet = safeStyledText(TextStyled)`
	width: 18px;
	font-size: 15px;
	line-height: 23px;
	color: ${getThemeColor(ColorKeys.primary)};
`
// The button in its own bar below the text, not inside it.
export const Container = styled.View`
  align-items: center;
  /*
	   The modal frame already includes the device bottom inset. A compact action
	   bar keeps the button close to that safe edge without a second fixed gap. */
  padding: 12px 24px;
  border-top-width: 1px;
  border-top-color: ${getThemeColor(ColorKeys.border)};
  background-color: ${getThemeColor(ColorKeys.background)};
`
