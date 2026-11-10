import { View, Image } from 'react-native'
import styled from 'styled-components/native'
import TextStyled, { safeStyledText } from '@shared/components/atomic_components/Text'
import { getThemeColor, ColorKeys } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

const HeaderStyled = {
  LinkHeader: styled(View)`
    padding-left: 24px;
    padding-right: 24px;
    /*
			 Reduces the space below the header, which now carries the wallet's name. */
    padding-bottom: 12px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  `,
  RowView: styled.View`
    display: flex;
    flex-direction: row;
    /*
			 Sizes the wallet's mark and name, set in Inter. */
    align-items: center;
  `,
  IconHeader: styled(Image)`
    width: 28px;
    height: 28px;
    margin-right: 10px;
  `,
  TextHeader: safeStyledText(TextStyled)`
		font-family: ${FONT_FAMILY.PRINCIPAL};
		font-weight: 700;
		font-size: 17px;
		color: ${getThemeColor(ColorKeys.invertedText)};
	`,
  // The language switch and "Skip" side by side.
  EndRow: styled.View`
    flex-direction: row;
    align-items: center;
  `,
  SkipButton: safeStyledText(TextStyled)`
		font-size: 14px;
		font-weight: 600;
		padding: 8px 0 8px 14px;
		color: ${getThemeColor(ColorKeys.invertedText)};
		opacity: 0.8;
	`,
}

export default HeaderStyled
