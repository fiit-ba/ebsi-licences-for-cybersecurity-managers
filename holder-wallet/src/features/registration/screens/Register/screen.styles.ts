import styled from 'styled-components/native'
// Uses React Native's maintained activity indicator after removing the legacy package.
import { ActivityIndicator } from 'react-native'

import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import ScreenMarginStyle from '@shared/components/wrappers/ScreenMarginStyle'
import { Title, DescriptionText, ErrorText } from '@shared/components/atomic_components/Text/variants'
import InputStyled, { safeStyledInput } from '@shared/components/atomic_components/InputStyled'
import ButtonStyled from '@shared/components/atomic_components/Button'
import CheckBoxStyled from '@shared/components/atomic_components/CheckBox'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { CONTROL_RADIUS } from '@shared/constants/ui'
// For the outlined button that leads to the verifier.
import { Button } from 'react-native-paper'

const defaultStyles = {
  MainContainer: styled(ScreenMarginStyle)``,
  RecoveryButton: styled(ButtonStyled).attrs((props) => ({
    mode: 'text',
    buttonColor: 'transparent',
    // A default: the restore screen's "Back" asks for arrow-left, which a
    // fixed attribute overrode.
    icon: props.icon ?? 'arrow-right',
    // Selects Inter's SemiBold face by weight.
    labelStyle: { color: getThemeColor(ColorKeys.primary), fontFamily: FONT_FAMILY.PRINCIPAL_600, fontWeight: '600' },
    contentStyle: {
      width: 150,
      backgroundColor: 'transparent',
    },
    width: 150,
  }))`
    /*
       The row it sits in (SetupTopBar) carries the spacing below it. */
    margin-left: -5%;
  `,
  Title: safeStyledText(Title)``,
  Subtitle: safeStyledText(DescriptionText)`
    margin-top: 31px;
    margin-bottom: 16px;
  `,
  InputsContainer: styled.View``,
  InputStyled: safeStyledInput(InputStyled)`
    margin-top: 5px;
  `,
  CheckBoxContainer: styled.View`
    padding-top: 24px;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
  `,
  Button: styled(ButtonStyled)``,
  // Moves checkbox spacing into CSS accepted by the current styled-components version.
  TermsCheckBox: styled(CheckBoxStyled)<any>`
    margin: 4px 5px;
  `,
  TermsText: safeStyledText(DescriptionText)`
    font-size: 14px;
    font-weight: normal;
    margin-bottom: 4px;
  `,

  ErrorText: safeStyledText(ErrorText)`
    margin-top: 10px;
  `,
  // Styles React Native's indicator in place of react-native-indicators.
  SplashActivityIndicator: styled(ActivityIndicator)`
    flex: 1;
    justify-content: flex-end;
    align-items: center;
    margin-bottom: 16px;
  `,
  ContainerBottom: styled.View`
    flex: 1;
    justify-content: flex-end;
    align-items: center;
    margin: 20px auto 40px auto;
    width: 100%;
  `,
  // ---  ---
  // The way to the verifier: a button as large as the one above it, since
  // verifying a certificate is as much what the app is for as keeping one.
  // Outlined, because on this screen registering is still the main path.
  Or: styled.View`
    flex-direction: row;
    align-items: center;
    width: 240px;
    margin: 14px 0;
  `,
  OrLine: styled.View`
    flex: 1;
    height: 1px;
    background-color: ${getThemeColor(ColorKeys.border)};
  `,
  OrText: safeStyledText(DescriptionText)`
    margin: 0 12px;
    color: ${getThemeColor(ColorKeys.mutedText)};
  `,
  // 237 x 43 inside a 1.5 px border: the same outer size as the button above.
  VerifyButton: styled(Button).attrs({
    mode: 'outlined',
    textColor: getThemeColor(ColorKeys.primary),
    labelStyle: {
      letterSpacing: 0.2,
      fontSize: 15,
      fontFamily: FONT_FAMILY.PRINCIPAL,
      fontWeight: '600',
    },
    contentStyle: { height: 46, width: 237, borderRadius: CONTROL_RADIUS },
  })`
    border-radius: ${CONTROL_RADIUS}px;
    border-width: 1.5px;
    border-color: ${getThemeColor(ColorKeys.primary)};
  `,
  VerifyHint: safeStyledText(DescriptionText)`
    margin-top: 8px;
    font-size: 13px;
    color: ${getThemeColor(ColorKeys.mutedText)};
    text-align: center;
  `,
  // --- End of the change made by the Faculty of Informatics and Information Technologies. ---
}
export default defaultStyles
