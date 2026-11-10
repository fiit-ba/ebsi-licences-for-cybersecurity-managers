import { View } from 'react-native'
import styled from 'styled-components'
import { DescriptionText, Title as StyledTitle } from '@shared/components/atomic_components/Text/variants'
import { Button } from 'react-native-paper'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { safeStyledText } from '@shared/components/atomic_components/Text'

const overlayColor = 'rgba(0, 0, 0, 0.6)'

export const ViewContainer = styled(View)`
	position: absolute;
	display: flex;
	flex-direction: row;
	flex: 1;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
`

export const BackButton = styled(Button).attrs(() => ({
  mode: 'contained',
  icon: 'arrow-left',
  buttonColor: 'rgba(8, 27, 58, 0.82)',
  textColor: getThemeColor(ColorKeys.invertedText),
  contentStyle: { height: 42, paddingHorizontal: 4 },
  labelStyle: { color: getThemeColor(ColorKeys.invertedText), fontSize: 15 },
}))`
	/*
	   Keeps the only solid control background readable over the camera. */
	align-self: flex-start;
	border-radius: 21px;
	margin-bottom: 24px;
`

export const LateralSpace = styled(View)`
	flex-grow: 1;
	background-color: ${overlayColor};
`

export const MarkerContainer = styled(View)`
	/*
	   Width is calculated from both window axes in QrCustomMarker. The layer
	   stays above the side masks so outward-facing corners remain visible. */
	z-index: 1;
`

export const TopSafeSpace = styled(View)`
	/*
	   Covers the camera behind the native status area while keeping controls below it. */
	background-color: ${overlayColor};
`

export const Marker = styled(View)`
	/*
	   A subtle square and four strong corners show the scan target without
	   covering the live camera or exposing mismatched rounded corners. Keep the
	   whole marker above the following bottom mask so its outward-facing lower
	   guides are not dimmed by that sibling. */
	position: relative;
	z-index: 2;
	overflow: visible;
	align-items: center;
	justify-content: center;
	border-width: 1px;
	border-color: rgba(255, 255, 255, 0.45);
	background-color: transparent;
`

export const MarkerCorner = styled(View)`
	position: absolute;
	width: 38px;
	height: 38px;
	border-color: rgba(255, 255, 255, 0.96);
`

export const TextContainer = styled(View)`
	/*
	   Starts directly below the safe area. It no longer consumes the remaining
	   height, so the back action stays near the top on tall and short phones. */
	padding-top: 8px;
	background-color: ${overlayColor};
`

export const InstructionPanel = styled(View)`
	/*
	   Text sits directly on the dimmed camera overlay; only the back button has
	   a filled background. */
	background-color: transparent;
`

export const Title = styled(StyledTitle)`
	font-size: 22px;
	line-height: 28px;
	color: white;
	margin-bottom: 8px;
`

export const SubTitle = safeStyledText(DescriptionText)`
	font-size: 15px;
	line-height: 22px;
	color: white;
`

export const BottomSpace = styled(View)`
	flex-grow: 1;
	z-index: 0;
	background-color: ${overlayColor};
`
