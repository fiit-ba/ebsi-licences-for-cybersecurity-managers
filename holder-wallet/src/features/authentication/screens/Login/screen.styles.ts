// The wallet's own sign-in screen (see docs/WALLET.md at the repository root).
import { Image, ImageBackground, ScrollView, View } from 'react-native'
import { Button } from 'react-native-paper'
import styled from 'styled-components'
import InputStyled, { safeStyledInput } from '@shared/components/atomic_components/InputStyled'
import TextStyled, { safeStyledText } from '@shared/components/atomic_components/Text'
import ButtonStyled from '@shared/components/atomic_components/Button'
import Colors, { ColorKeys, getColorByBackground, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { CONTROL_RADIUS } from '@shared/constants/ui'

const actionBackground = (disabled?: boolean) => getThemeColor(disabled ? ColorKeys.disabled : ColorKeys.primary)

const defaultStyles = {
  Screen: styled(View)`
		flex: 1;
		background-color: ${getThemeColor(ColorKeys.background)};
	`,
  Scroll: styled(ScrollView)`
		flex: 1;
	`,

  Hero: styled(ImageBackground).attrs({ resizeMode: 'cover' })`
		align-items: center;
		padding: 0 24px 56px 24px;
		background-color: ${getThemeColor(ColorKeys.headerBackground)};
	`,
  LanguageCorner: styled(View)`
		position: absolute;
		right: 20px;
	`,
  Mark: styled(Image)`
		width: 76px;
		height: 76px;
	`,
  BrandName: safeStyledText(TextStyled).attrs({ fontWeight: '700' })`
		margin-top: 16px;
		font-size: 28px;
		line-height: 34px;
		letter-spacing: -0.4px;
		color: ${Colors.light.invertedText};
		text-align: center;
	`,
  Tagline: safeStyledText(TextStyled)`
		margin-top: 6px;
		font-size: 14px;
		line-height: 20px;
		color: ${Colors.light.invertedText};
		opacity: 0.75;
		text-align: center;
	`,

  // Rises over the header's lower edge.
  Card: styled(View)`
		margin-top: -24px;
		padding: 28px 24px 8px 24px;
		border-top-left-radius: 24px;
		border-top-right-radius: 24px;
		background-color: ${getThemeColor(ColorKeys.background)};
	`,
  Title: safeStyledText(TextStyled).attrs({ fontWeight: '700' })`
		font-size: 22px;
		line-height: 28px;
		color: ${getThemeColor(ColorKeys.text)};
	`,
  Hint: safeStyledText(TextStyled)`
		margin-top: 6px;
		font-size: 14px;
		line-height: 20px;
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
  InputStyled: safeStyledInput(InputStyled)`
		margin-top: 22px;
		padding-left: 0;
	`,
  Button: styled(ButtonStyled).attrs((props: any) => ({
    labelStyle: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.2,
      fontFamily: FONT_FAMILY.PRINCIPAL,
      color: getColorByBackground(ColorKeys.buttonText, actionBackground(props.disabled)),
    },
    contentStyle: {
      height: 52,
      borderRadius: CONTROL_RADIUS,
      backgroundColor: actionBackground(props.disabled),
    },
  }))`
		margin-top: 20px;
		width: 100%;
		border-radius: ${CONTROL_RADIUS}px;
	`,

  Footer: styled(View)`
		flex-grow: 1;
		justify-content: flex-end;
		align-items: center;
		padding-top: 24px;
	`,
  RegisterButton: styled(Button).attrs(() => ({
    mode: 'text',
    icon: 'plus-circle-outline',
    textColor: getThemeColor(ColorKeys.primary),
    labelStyle: { fontFamily: FONT_FAMILY.PRINCIPAL, fontWeight: '600', fontSize: 15 },
  }))``,
  // ---  ---
  // Switching between certificate holder and organization, and verifying
  // without signing in (design decisions D14, D15). The organization's way in is
  // in its violet.
  SwitchButton: styled(Button).attrs(() => ({
    mode: 'text',
    textColor: getThemeColor(ColorKeys.primary),
    labelStyle: { fontFamily: FONT_FAMILY.PRINCIPAL, fontWeight: '600', fontSize: 15 },
  }))``,
  OrgSwitchButton: styled(Button).attrs(() => ({
    mode: 'text',
    textColor: getThemeColor(ColorKeys.orgPrimary),
    labelStyle: { fontFamily: FONT_FAMILY.PRINCIPAL, fontWeight: '600', fontSize: 15 },
  }))``,
  OrgName: safeStyledText(TextStyled)`
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.6px;
		text-transform: uppercase;
		color: ${getThemeColor(ColorKeys.orgPrimary)};
	`,
  // An organization whose accreditation was revoked (design decisions D24).
  RevokedTitle: safeStyledText(TextStyled)`
		margin-top: 12px;
		font-size: 16px;
		font-weight: 700;
		color: ${getThemeColor(ColorKeys.error)};
	`,
  RevokedText: safeStyledText(TextStyled)`
		margin-top: 6px;
		font-size: 14px;
		line-height: 20px;
		color: ${getThemeColor(ColorKeys.text)};
	`,
  // --- End of the change made by the Faculty of Informatics and Information Technologies. ---
}

export default defaultStyles
