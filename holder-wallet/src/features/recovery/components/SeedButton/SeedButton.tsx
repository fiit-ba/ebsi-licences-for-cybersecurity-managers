import SeedButtonView from './SeedButtonView'
import useSeedButton from './useSeedButton'
import { SeedButtonProps } from './component.types'

const SeedButton = (props: SeedButtonProps) => <SeedButtonView {...useSeedButton(props)} />
export default SeedButton
