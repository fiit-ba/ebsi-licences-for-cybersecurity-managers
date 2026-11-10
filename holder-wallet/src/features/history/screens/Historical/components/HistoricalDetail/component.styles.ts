import styled from 'styled-components/native'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CONTROL_RADIUS } from '@shared/constants/ui'

const componentStyles = {
  HistoricalDetailContainer: styled.View`
    flex-direction: row;
    align-items: flex-start;
    min-height: 100px;
    margin-bottom: 10px;
    padding: 14px;
    border-width: 1px;
    border-color: ${getThemeColor(ColorKeys.border)};
    border-radius: ${CONTROL_RADIUS}px;
    background-color: ${getThemeColor(ColorKeys.surface)};
  `,
  IconColumn: styled.View`
    width: 40px;
    align-items: center;
    margin-right: 12px;
    background-color: transparent;
  `,
  IconCircle: styled.View<{ $color: string }>`
    width: 40px;
    height: 40px;
    border-radius: 20px;
    align-items: center;
    justify-content: center;
    background-color: ${({ $color }) => `${$color}18`};
  `,
  HistoryContent: styled.View`
    flex: 1;
    min-width: 0px;
    background-color: transparent;
  `,
  HistoryTitle: safeStyledText(DescriptionText)`
		font-size: 16px;
		line-height: 21px;
		font-weight: 700;
		margin-bottom: 7px;
	`,
  InfoRow: styled.View`
    flex-direction: row;
    align-items: flex-start;
    margin-bottom: 5px;
    background-color: transparent;
  `,
  InfoLabel: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		font-weight: 600;
		color: ${getThemeColor(ColorKeys.mutedText)};
		margin-right: 7px;
	`,
  InfoValue: safeStyledText(DescriptionText)`
		flex: 1;
		min-width: 0px;
		font-size: 12px;
		line-height: 17px;
	`,
  IssuerPressable: styled.Pressable`
    flex: 1;
    min-width: 0px;
    min-height: 20px;
    flex-direction: row;
    align-items: center;
    column-gap: 6px;
    background-color: transparent;
  `,
  IssuerValue: safeStyledText(DescriptionText)`
		flex: 1;
		min-width: 0px;
		font-size: 12px;
		line-height: 17px;
	`,
  OutcomeBadge: styled.View<{ $color: string }>`
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: 9px;
    background-color: ${({ $color }) => `${$color}18`};
  `,
  OutcomeText: safeStyledText(DescriptionText)<{ $color: string }>`
		font-size: 11px;
		line-height: 16px;
		font-weight: 700;
		color: ${({ $color }: { $color: string }) => $color};
	`,
  DateRow: styled.View`
    flex-direction: row;
    align-items: center;
    margin-top: 3px;
    background-color: transparent;
  `,
  DateText: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		color: ${getThemeColor(ColorKeys.mutedText)};
		margin-left: 6px;
	`,
}

export default componentStyles
