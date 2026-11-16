import styled from 'styled-components/native'
import { View } from 'react-native'
import { getThemeColor, ColorKeys } from '@shared/constants/Colors'
import { Title, DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
// Left-aligned, Inter; justified text left holes between words.
const OnBoardingDescriptionStyled = {
  DescriptionContent: styled(View)`
    width: 100%;
    padding: 0 8%;
  `,
  Subtitle: safeStyledText(DescriptionText)`
		margin-top: 12px;
		font-size: 15px;
		line-height: 22px;
		letter-spacing: 0px;
		color: ${getThemeColor(ColorKeys.invertedText)};
		opacity: 0.82;
	`,
  Title: safeStyledText(Title)`
		font-size: 26px;
		line-height: 32px;
		letter-spacing: -0.3px;
		color: ${getThemeColor(ColorKeys.invertedText)};
	`,
  TitleContainer: styled.View`
    flex-direction: row;
    justify-content: space-between;
  `,
}

export default OnBoardingDescriptionStyled
