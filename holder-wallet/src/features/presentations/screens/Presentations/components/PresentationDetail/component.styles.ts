import styled from 'styled-components/native'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CONTROL_RADIUS } from '@shared/constants/ui'

const componentStyles = {
  PresentationDetailContainer: styled.View<{ $selected: boolean }>`
    border-width: ${({ $selected }) => ($selected ? 2 : 1)}px;
    border-color: ${({ $selected }) =>
      $selected ? getThemeColor(ColorKeys.primary) : getThemeColor(ColorKeys.border)};
    border-radius: ${CONTROL_RADIUS}px;
    margin: 0px 16px 12px 16px;
    background-color: ${({ $selected }) =>
      $selected ? getThemeColor(ColorKeys.scrollBackground) : getThemeColor(ColorKeys.surface)};
    overflow: hidden;
  `,
  CardHeader: styled.Pressable`
    min-height: 88px;
    flex-direction: row;
    align-items: center;
    padding: 14px;
  `,
  CheckBoxView: styled.View`
    margin-left: -8px;
    margin-right: 2px;
    background-color: transparent;
  `,
  IconCircle: styled.View`
    width: 40px;
    height: 40px;
    border-radius: 20px;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    background-color: ${getThemeColor(ColorKeys.scrollBackground)};
  `,
  CardSummary: styled.View`
    flex: 1;
    min-width: 0px;
    background-color: transparent;
  `,
  CardTitle: safeStyledText(DescriptionText)`
		font-size: 15px;
		line-height: 20px;
		font-weight: 700;
	`,
  CardMeta: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		color: ${getThemeColor(ColorKeys.mutedText)};
		margin-top: 4px;
	`,
  LegacyBadge: styled.View`
    align-self: flex-start;
    border-radius: 8px;
    padding: 3px 7px;
    margin-top: 7px;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  LegacyText: safeStyledText(DescriptionText)`
		font-size: 10px;
		line-height: 14px;
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
  DetailsContainer: styled.View`
    border-top-width: 1px;
    border-top-color: ${getThemeColor(ColorKeys.border)};
    padding: 14px 16px 16px 16px;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  DetailsTitle: safeStyledText(DescriptionText)`
		font-size: 13px;
		line-height: 18px;
		font-weight: 700;
		margin-bottom: 10px;
	`,
  DetailRow: styled.View`
    margin-bottom: 8px;
    background-color: transparent;
  `,
  DetailLabel: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		font-weight: 600;
		margin-bottom: 2px;
	`,
  DetailValue: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
}

export default componentStyles
