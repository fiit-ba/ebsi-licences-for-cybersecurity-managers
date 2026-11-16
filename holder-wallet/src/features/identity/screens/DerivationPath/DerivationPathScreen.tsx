import DerivationPathScreenView from './DerivationPathScreenView'
import { DerivationPathScreenProps } from './screen.types'
import useDerivationPathScreen from './useDerivationPathScreen'

const DerivationPathScreen = (props: DerivationPathScreenProps) => (
  <DerivationPathScreenView {...useDerivationPathScreen(props)} />
)

export default DerivationPathScreen
