import { Text } from 'react-native'
import { List } from 'react-native-paper'
import styled from 'styled-components/native'
import { View } from '@shared/components/Themed'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CONTROL_RADIUS } from '@shared/constants/ui'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

const componentStyles = {
  CredentialDetailContainer: styled.View<{ $attention: boolean }>`
    border-width: 1px;
    border-color: ${({ $attention }) =>
      $attention ? getThemeColor(ColorKeys.error) : getThemeColor(ColorKeys.border)};
    border-radius: ${CONTROL_RADIUS}px;
    margin: 0px 16px 12px 16px;
    background-color: ${getThemeColor(ColorKeys.surface)};
    overflow: hidden;
  `,
  LabelText: styled(Text)`
    color: ${getThemeColor(ColorKeys.mutedText)};
    font-weight: 600;
  `,
  MetadataText: safeStyledText(DescriptionText)`
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
  ExpirationText: styled(Text)<{ isExpired: boolean }>`
    color: ${({ isExpired }) => (isExpired ? getThemeColor(ColorKeys.error) : getThemeColor(ColorKeys.placeholder))};
  `,
  StyledAccordion: styled(List.Accordion).attrs({
    titleStyle: {
      color: getThemeColor(ColorKeys.text),
      fontFamily: FONT_FAMILY.PRINCIPAL,
      fontSize: 16,
      fontWeight: '600',
      lineHeight: 22,
    },
    descriptionStyle: { marginTop: 6 },
  })`
    padding-vertical: 8px;
    background-color: ${getThemeColor(ColorKeys.surface)};
  `,
  PdfActionContainer: styled.View`
    align-items: center;
    padding: 4px 14px 14px 14px;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  ExpandedContent: styled.View`
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  LoadingContainer: styled(View)`
    padding: 16px;
  `,
}

export default componentStyles
