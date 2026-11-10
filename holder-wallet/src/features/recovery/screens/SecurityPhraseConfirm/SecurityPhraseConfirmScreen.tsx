import SecurityPhraseConfirmScreenView from './SecurityPhraseConfirmScreenView'
import { SecurityPhraseConfirmScreenProps } from './screen.types'
import useSecurityPhraseConfirmScreen from './useSecurityPhraseConfirmScreen'

const SecurityPhraseConfirmScreen = (props: SecurityPhraseConfirmScreenProps) => (
  <SecurityPhraseConfirmScreenView {...useSecurityPhraseConfirmScreen(props)} />
)

export default SecurityPhraseConfirmScreen
