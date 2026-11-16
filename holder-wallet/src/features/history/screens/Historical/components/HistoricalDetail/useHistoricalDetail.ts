import { useContext } from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import { useTranslation } from 'react-i18next'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import historicalI18nKeys from '../../i18n/keys'
import { stateNameKey } from '@features/verification/screens/Verify/components/Outcome'
import { historyActionAppearance } from './HistoricalDetailView'
import { HistoricalDetailProps, HistoricalDetailViewProps } from './component.types'

const useHistoricalDetail = (props: HistoricalDetailProps): HistoricalDetailViewProps => {
  const { t } = useTranslation(SCREEN.Historical)
  const { t: tVerify } = useTranslation(SCREEN.Verify)
  const { showMessage } = useContext(MessageContext)
  const appearance = historyActionAppearance(props.title, props.outcome)
  return {
    ...props,
    appearance,
    message: t(historicalI18nKeys[appearance.messageKey]),
    resultLabel: t(historicalI18nKeys.RESULT),
    outcomeLabel: props.outcome ? tVerify(stateNameKey(props.outcome)) : undefined,
    kindLabel: t(historicalI18nKeys.KIND),
    issuerLabel: t(historicalI18nKeys.CREDENTIAL_DETAILS_ISSUER),
    issuerCopyHint: t(historicalI18nKeys.COPY_ORGANISATION_HINT),
    mutedColor: getThemeColor(ColorKeys.mutedText),
    copyIssuer: () => {
      if (!props.issuer) return
      Clipboard.setString(props.issuer)
      showMessage?.({ content: t(historicalI18nKeys.ORGANISATION_COPIED), type: 'success' })
    },
  }
}
export default useHistoricalDetail
