import styled from 'styled-components/native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
// Flexible cards and text replace fixed 210 px rows. The layout can grow with
// translations and accessibility fonts on compact Android and large iOS devices.
const defaultStyles = {
  ContentView: styled.View`
    flex: 1;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
}

export default defaultStyles
