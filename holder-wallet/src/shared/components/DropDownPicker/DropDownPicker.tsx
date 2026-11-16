import DropDownPickerView from './DropDownPickerView'
import useDropDownPicker from './useDropDownPicker'
import { DropDownPickerProps } from './component.types'

const DropDownPicker = (props: DropDownPickerProps) => <DropDownPickerView {...useDropDownPicker(props)} />
export default DropDownPicker
