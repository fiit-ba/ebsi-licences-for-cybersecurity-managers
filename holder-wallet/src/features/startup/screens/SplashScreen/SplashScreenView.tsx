import SplashScreenStyled from './screen.styles'
const SplashScreenView = () => (
  <SplashScreenStyled.Container>
    <SplashScreenStyled.SplashImageBackground>
      <SplashScreenStyled.SplashLogo />
    </SplashScreenStyled.SplashImageBackground>
    <SplashScreenStyled.SplashActivityIndicator />
  </SplashScreenStyled.Container>
)
export default SplashScreenView
