import styled from 'styled-components/native'
// Uses React Native's maintained activity indicator after removing the legacy package.
import { ActivityIndicator, ImageBackground } from 'react-native'
import { IMG } from '@shared/constants/urlImages'
import Colors from '@shared/constants/Colors'
import { TEST_LABELS } from '@features/startup/screens/SplashScreen/constants/testLabels'

const DefaultStyles = {
  Container: styled.View`
    flex: 1;
    background-color: ${Colors.light.headerBackground};
  `,
  SplashImageBackground: styled(ImageBackground).attrs({
    accessibilityLabel: TEST_LABELS.BACKGROUND_IMAGE,
    // Uses the wallet's background artwork.
    source: IMG.BRAND_BACKGROUND,
    resizeMode: 'cover',
  })`
    width: 100%;
    flex: 1;
    align-items: center;
    justify-content: center;
  `,
  // The wallet's lockup (design/svg/logo-lockup.svg), 720:560.
  SplashLogo: styled.Image.attrs({
    source: IMG.SPLASH_LOGO,
  })`
    width: 64%;
    aspect-ratio: 1.2857;
    resize-mode: contain;
  `,
  // Styles React Native's indicator in place of react-native-indicators.
  SplashActivityIndicator: styled(ActivityIndicator).attrs({
    size: 35,
    color: Colors.light.loading,
  })`
    position: absolute;
    right: 0;
    left: 0;
    bottom: 9%;
  `,
}

export default DefaultStyles
