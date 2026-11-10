import styled from 'styled-components/native'
// Adds the native style type used by the copyable credential value container.
import { Text, View, type ViewStyle } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
// Reworks credential details into readable sections with complete, copyable values.
export const Container = styled(View)`
  padding: 14px;
  border-top-width: 1px;
  border-top-color: ${getThemeColor(ColorKeys.border)};
  background-color: ${getThemeColor(ColorKeys.background)};
`

export const CopyHintRow = styled(View)`
  flex-direction: row;
  align-items: center;
  margin-bottom: 12px;
  padding: 7px 9px;
  border-radius: 10px;
  background-color: ${getThemeColor(ColorKeys.scrollBackground)};
`

export const CopyHintText = styled(Text)`
  flex: 1;
  min-width: 0px;
  margin-left: 7px;
  font-size: 11px;
  line-height: 15px;
  color: ${getThemeColor(ColorKeys.mutedText)};
`

export const Row = styled(View)`
  flex-direction: row;
  align-items: flex-start;
  min-height: 26px;
  margin-bottom: 4px;
`

export const LabelText = styled(Text)`
  width: 38%;
  flex-shrink: 0;
  padding-right: 10px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: ${getThemeColor(ColorKeys.text)};
`

export const ValueText = styled(Text)<{ $color?: string }>`
  flex-shrink: 1;
  min-width: 0px;
  font-size: 13px;
  line-height: 18px;
  color: ${({ $color }) => $color || getThemeColor(ColorKeys.mutedText)};
`

export const copyableValueStyle: ViewStyle = {
  flex: 1,
  minWidth: 0,
  borderRadius: 8,
}

export const SectionHeader = styled(View)`
  margin-top: 10px;
  margin-bottom: 8px;
  padding-top: 12px;
  border-top-width: 1px;
  border-top-color: ${getThemeColor(ColorKeys.border)};
`

export const SectionTitle = styled(Text)`
  font-size: 14px;
  line-height: 19px;
  font-weight: 700;
  color: ${getThemeColor(ColorKeys.text)};
`
