import React from 'react'
import { ImageSourcePropType } from 'react-native'
import SwiperPageStyled from '@features/onboarding/screens/OnBoarding/components/SwiperPageWrapper/styles'
// Illustration above the text, the page's action (the last page's
// button) in a footer kept clear of the pagination dots.
interface Props {
  illustration?: ImageSourcePropType
  // Uses React 19 node types so descriptions and children may remain arrays or elements.
  renderDescription: React.ReactNode
  children?: React.ReactNode
}
const SwiperPageWrapper = (props: Props) => {
  return (
    <SwiperPageStyled.SwiperPageContent>
      <SwiperPageStyled.IllustrationContainer>
        {props.illustration && <SwiperPageStyled.Illustration source={props.illustration} />}
      </SwiperPageStyled.IllustrationContainer>
      <SwiperPageStyled.DescriptionContent>{props.renderDescription}</SwiperPageStyled.DescriptionContent>
      <SwiperPageStyled.Footer>{props.children}</SwiperPageStyled.Footer>
    </SwiperPageStyled.SwiperPageContent>
  )
}

export default SwiperPageWrapper
