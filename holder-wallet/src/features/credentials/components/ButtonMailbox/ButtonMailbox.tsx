import ButtonMailboxView from './ButtonMailboxView'
import useButtonMailbox from './useButtonMailbox'
import { ButtonMailboxProps } from './component.types'

const ButtonMailbox = (props: ButtonMailboxProps) => <ButtonMailboxView {...useButtonMailbox(props)} />
export default ButtonMailbox
