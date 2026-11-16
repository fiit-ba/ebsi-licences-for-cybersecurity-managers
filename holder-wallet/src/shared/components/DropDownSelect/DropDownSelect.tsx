import DropDownSelectView from './DropDownSelectView'
import useDropDownSelect from './useDropDownSelect'
import { DropDownSelectProps } from './component.types'

const DropDownSelect = (props: DropDownSelectProps) => <DropDownSelectView {...useDropDownSelect(props)} />
export default DropDownSelect
