// "Všetky" translated instead of the hard-coded Spanish "Todo".
import React from 'react'
import RequestPresentationModalStyled from '@features/presentations/components/RequestPresentationModal/component.styles'
import { Checkbox } from 'react-native-paper'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { getThemeColor, ColorKeys } from '@shared/constants/Colors'
import { useTranslation } from 'react-i18next'
import requestPresentationModalI18nKeys from '@features/presentations/components/RequestPresentationModal/i18n/keys'
interface Props {
  isCheck: boolean
  onPressCheckBox: () => void
}
const HeaderCredential = (props: Props) => {
  const { t } = useTranslation('RequestPresentationModal')
  return (
    <RequestPresentationModalStyled.HeaderContainer>
      <Checkbox.Android
        color={getThemeColor(ColorKeys.primary)}
        status={props.isCheck ? 'checked' : 'unchecked'}
        onPress={props.onPressCheckBox}
      />
      {/*
          Uses a translated label instead of the hard-coded Spanish one. */}
      <DescriptionText>{t(requestPresentationModalI18nKeys.ALL)}</DescriptionText>
    </RequestPresentationModalStyled.HeaderContainer>
  )
}

export default HeaderCredential
