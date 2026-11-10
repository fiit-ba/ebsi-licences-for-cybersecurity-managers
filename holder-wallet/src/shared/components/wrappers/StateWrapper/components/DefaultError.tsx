import React from 'react'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { useTranslation } from 'react-i18next'
import { bundleName } from '@shared/components/wrappers/StateWrapper/constants'
import stateWrapperI18nKeys from '@shared/components/wrappers/StateWrapper/i18n/keys'

const DefaultError = () => {
  const { t } = useTranslation(bundleName)
  return (
    <>
      <DescriptionText>{t(stateWrapperI18nKeys.ERROR_MESSAGE)}</DescriptionText>
    </>
  )
}

export default DefaultError
