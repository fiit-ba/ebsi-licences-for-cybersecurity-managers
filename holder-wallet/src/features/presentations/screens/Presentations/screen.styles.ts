import styled from 'styled-components/native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

const screenStyles = {
  ContentView: styled.View`
    flex: 1;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  ScanAction: styled.View`
    align-items: center;
    padding: 12px 16px 0 16px;
    background-color: transparent;
  `,
}

export default screenStyles
