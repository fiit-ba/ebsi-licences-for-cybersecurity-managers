import { StatusBar } from 'react-native'
import { IMG } from '@shared/constants/urlImages'
import SwiperPageWrapper from './components/SwiperPageWrapper'
import OnBoardingDescription from './components/OnBoardingDescription'
import OnBoardingStyled from './screen.styles'
import { OnBoardingScreenViewProps } from './screen.types'
type Props = OnBoardingScreenViewProps & { continueLabel: string }
const OnBoardingScreenView = ({
  pages,
  activePage,
  bottomInset,
  onPageSelected,
  onContinue,
  continueLabel,
  header,
}: Props) => (
  <OnBoardingStyled.MainView>
    <StatusBar barStyle="light-content" />
    <OnBoardingStyled.ImageScreen source={IMG.BRAND_BACKGROUND}>
      {header}
      <OnBoardingStyled.SwiperStyled
        initialPage={0}
        onPageSelected={({ nativeEvent }) => onPageSelected(nativeEvent.position)}
      >
        {pages.map(({ illustration, title, subtitle }, index) => (
          <SwiperPageWrapper
            key={'SwiperPageWrapper-' + index}
            illustration={illustration}
            renderDescription={<OnBoardingDescription title={title} subtitle={subtitle} />}
          >
            {index === pages.length - 1 ? (
              <OnBoardingStyled.BottomContainer>
                <OnBoardingStyled.WhiteButton onPress={onContinue}>{continueLabel}</OnBoardingStyled.WhiteButton>
              </OnBoardingStyled.BottomContainer>
            ) : null}
          </SwiperPageWrapper>
        ))}
      </OnBoardingStyled.SwiperStyled>
      <OnBoardingStyled.Pagination style={{ bottom: bottomInset + 12 }} accessibilityRole="tablist">
        {pages.map((_, index) => (
          <OnBoardingStyled.PaginationDot key={`OnBoardingDot-${index}`} active={index === activePage} />
        ))}
      </OnBoardingStyled.Pagination>
    </OnBoardingStyled.ImageScreen>
  </OnBoardingStyled.MainView>
)
export default OnBoardingScreenView
