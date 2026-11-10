import { View } from 'react-native'
import { Button } from 'react-native-paper'
import styled from 'styled-components'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import DescriptionText from '@shared/components/atomic_components/Text/variants/DescriptionText'
import Title from '@shared/components/atomic_components/Text/variants/Title'
import ScreenMarginStyle from '@shared/components/wrappers/ScreenMarginStyle'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

const defaultStyles = {
  MainContainer: styled(ScreenMarginStyle)`
`,

  RecoveryButton: styled(Button).attrs(() => ({
    icon: 'arrow-left',
    labelStyle: { color: getThemeColor(ColorKeys.primary) },
  }))`
    /*
       A fixed width and offset, as on the other setup screens: 22% of the
       row it now shares with the language switch cut the label off. The row
       (SetupTopBar) carries the spacing around it. */
    width: 100px;
    margin-left: -15px;
  `,

  Title: safeStyledText(Title)`
  margin-bottom: 46px;
  `,

  Subtitle: safeStyledText(DescriptionText)`
  margin-bottom: 16px;
  /*
     Left-aligned: justified, the narrow column opened wide gaps between words. */
  text-align: left;
  `,

  Button: styled(ButtonStyled)``,

  ContainerBottom: styled(View)`
  flex: 1;
  justify-content: flex-end;
  align-items: center;
  margin: 20px auto 40px auto;
  width: 100%;
  `,

  Container: styled(View)`
  flex: 1;
  `,

  ButtonContainer: styled(View)`
    flex-direction: row; 
    flex-wrap: wrap; 
    justify-content: center;
    margin-top: 24px;
  `,

  ResetButton: styled(Button).attrs((props) => ({
    color: getThemeColor(ColorKeys.primary),
    buttonColor: getThemeColor(ColorKeys.background),
    textColor: getThemeColor(ColorKeys.primary),
    borderWidth: 0,
  }))`
      margin-top: 30px;
      height:39px;
      width:90px;
      border-radius:45px;
      align-self: flex-end;
    `,
}

export default defaultStyles
