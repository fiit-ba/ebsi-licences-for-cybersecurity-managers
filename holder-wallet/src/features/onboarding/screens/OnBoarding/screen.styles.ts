import styled from 'styled-components/native'
import { View, ImageBackground } from 'react-native'
// Replaces the patched unmaintained swiper with a New Architecture compatible pager.
import PagerView from 'react-native-pager-view'
// Imports the palette itself, for the white button's fixed blue label.
import Colors, { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import ButtonStyled from '@shared/components/atomic_components/Button'
import ScreenView from '@shared/components/ScreenView'
import { TEST_LABELS } from '@features/onboarding/screens/OnBoarding/constants/testLabels'
import { CONTROL_HEIGHT, CONTROL_RADIUS } from '@shared/constants/ui'

const defaultStyles = {
  MainView: styled(ScreenView)`
    flex: 1;
    flex-direction: column;
  `,
  // The wallet's own look (see docs/WALLET.md) - brand background, no
  // photo; elongated active dot, kept clear below the last page's button.
  // Styles the replacement pager and supplies equivalent custom pagination dots.
  SwiperStyled: styled(PagerView)`
    flex: 1;
  `,
  Pagination: styled(View)`
    position: absolute;
    align-self: center;
    flex-direction: row;
    gap: 8px;
  `,
  PaginationDot: styled(View)<{ active: boolean }>`
    width: ${({ active }) => (active ? 22 : 8)}px;
    height: 8px;
    border-radius: 4px;
    background-color: ${({ active }) =>
      active ? getThemeColor(ColorKeys.invertedText) : getThemeColor(ColorKeys.inactiveDot)};
  `,
  ImageScreen: styled(ImageBackground).attrs({
    accessibilityLabel: TEST_LABELS.BACKGROUND_IMAGE,
    imageStyle: { resizeMode: 'cover' },
  })`
    width: 100%;
    flex: 1;
    background-color: ${getThemeColor(ColorKeys.headerBackground)};
    justify-content: space-between;
  `,
  WhiteButton: styled(ButtonStyled).attrs((props) => ({
    mode: 'contained',
    buttonColor: props.disabled ? getThemeColor(ColorKeys.disabled) : getThemeColor(ColorKeys.invertedText),
    labelStyle: {
      // Uses Inter SemiBold at the wallet's button size.
      letterSpacing: 0.2,
      fontSize: 15,
      fontWeight: '600',
      color: Colors.light.primary,
    },
    contentStyle: {
      height: CONTROL_HEIGHT,
      width: 240,
      borderRadius: CONTROL_RADIUS,
      backgroundColor: props.disabled ? getThemeColor(ColorKeys.disabled) : getThemeColor(ColorKeys.invertedText),
      borderColor: getThemeColor(ColorKeys.primary),
    },
  }))`
    border-radius: ${CONTROL_RADIUS}px;
  `,
  BottomContainer: styled(View)`
    /*
			 Drops the fixed margin: the page's footer places the button. */
    align-self: center;
  `,
}

export default defaultStyles
