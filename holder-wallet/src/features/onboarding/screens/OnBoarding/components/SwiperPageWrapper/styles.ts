import styled from 'styled-components/native'

const SwiperPageStyled = {
  SwiperPageContent: styled.View`
    flex: 1;
  `,
  // Places the illustration above the text and adds a footer for the page's
  // action.
  IllustrationContainer: styled.View`
    flex: 1;
    align-items: center;
    justify-content: center;
  `,
  // design/svg/onboarding-*.svg are 600:520.
  Illustration: styled.Image`
    width: 86%;
    max-height: 100%;
    aspect-ratio: 1.1538;
    resize-mode: contain;
  `,
  DescriptionContent: styled.View`
    width: 100%;
  `,
  Footer: styled.View`
    height: 126px;
    flex-shrink: 0;
    padding-top: 10px;
  `,
}

export default SwiperPageStyled
