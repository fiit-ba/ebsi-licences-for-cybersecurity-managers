import styled from 'styled-components/native'
import { Button } from 'react-native-paper'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CONTROL_RADIUS } from '@shared/constants/ui'

const componentStyles = {
  Toolbar: styled.View`
    flex-direction: row;
    align-items: center;
    margin: 12px 16px 10px 16px;
    padding: 10px 12px;
    border-radius: ${CONTROL_RADIUS}px;
    border-width: 1px;
    border-color: ${getThemeColor(ColorKeys.border)};
    background-color: ${getThemeColor(ColorKeys.surface)};
  `,
  ToolbarCopy: styled.View`
    flex: 1;
    min-width: 0px;
    background-color: transparent;
  `,
  ToolbarTitle: safeStyledText(DescriptionText)`
		font-size: 16px;
		line-height: 21px;
		font-weight: 700;
	`,
  ToolbarSubtitle: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		color: ${getThemeColor(ColorKeys.mutedText)};
		margin-top: 2px;
	`,
  SelectionBar: styled.View`
    align-items: stretch;
    margin: 12px 16px 10px 16px;
    padding: 10px;
    border-radius: 14px;
    background-color: ${getThemeColor(ColorKeys.scrollBackground)};
  `,
  SelectionHeader: styled.View`
    min-height: 38px;
    flex-direction: row;
    align-items: center;
    background-color: transparent;
  `,
  SelectedCount: safeStyledText(DescriptionText)`
		flex: 1;
		min-width: 0px;
		font-size: 13px;
		line-height: 18px;
		font-weight: 700;
		margin-right: 8px;
	`,
  SelectAllButton: styled(Button)`
    flex-shrink: 1;
    border-radius: ${CONTROL_RADIUS}px;
  `,
  SelectionActions: styled.View`
    flex-direction: row;
    align-items: center;
    margin-top: 8px;
    background-color: transparent;
  `,
  SelectionActionSlot: styled.View<{ $withGap?: boolean }>`
    flex: 1;
    min-width: 0px;
    margin-left: ${({ $withGap }) => ($withGap ? 12 : 0)}px;
    background-color: transparent;
  `,
  EmptyState: styled.View`
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    background-color: transparent;
  `,
  EmptyStateText: safeStyledText(DescriptionText)`
		font-size: 14px;
		line-height: 20px;
		text-align: center;
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
  ListFooter: styled.View`
    height: 16px;
  `,
}

export default componentStyles
