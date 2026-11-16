import SecurityPhraseScreenView from './SecurityPhraseScreenView'
import { SecurityPhraseScreenProps } from './screen.types'
import useSecurityPhraseScreen from './useSecurityPhraseScreen'

const SecurityPhraseScreen = (props: SecurityPhraseScreenProps) => (
  <SecurityPhraseScreenView {...useSecurityPhraseScreen(props)} />
)

export default SecurityPhraseScreen
