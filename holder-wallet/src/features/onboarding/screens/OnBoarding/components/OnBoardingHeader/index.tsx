import React from 'react'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { IMG } from '@shared/constants/urlImages'
// Imports the wallet's name (src/constants/brand.ts).
import { BRAND } from '@shared/constants/brand'
import OnBoardingI18nKeys from '@features/onboarding/screens/OnBoarding/i18n/keys'
import HeaderStyled from '@features/onboarding/screens/OnBoarding/components/OnBoardingHeader/styles'
// The language switch.
import LanguageToggle from '@shared/components/LanguageToggle'
// Replaces the removed legacy navigation type with the current stack contract.
import { RootStackScreenProps } from '@app/navigation/types'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
interface Props {
  navigation: RootStackScreenProps<'OnBoarding'>['navigation']
}

const Header = (props: Props) => {
  const { t } = useTranslation(SCREEN.OnBoarding)
  const insets = useSafeAreaInsets()
  return (
    <HeaderStyled.LinkHeader style={{ paddingTop: insets.top + 12 }}>
      <HeaderStyled.RowView>
        {/*
            The wallet's mark and name, where atest's logo and a
            "more information" label that led nowhere were. */}
        <HeaderStyled.IconHeader source={IMG.BRAND_MARK} />
        <HeaderStyled.TextHeader>{BRAND.NAME}</HeaderStyled.TextHeader>
      </HeaderStyled.RowView>
      {/*
          The language switch, next to "Skip". */}
      <HeaderStyled.EndRow>
        <LanguageToggle />
        <HeaderStyled.SkipButton onPress={() => props.navigation.navigate(SCREEN.Register)}>
          {t(OnBoardingI18nKeys.SKIP)}
        </HeaderStyled.SkipButton>
      </HeaderStyled.EndRow>
    </HeaderStyled.LinkHeader>
  )
}

export default Header
