import RNDropDownPicker from 'react-native-dropdown-picker'
import { DropDownPickerViewProps } from './component.types'

const DropDownPickerView = ({
  items,
  placeholder,
  open,
  value,
  theme,
  setOpen,
  setValue,
  changeValue,
  notifyOpenChange,
}: DropDownPickerViewProps) => {
  return (
    <RNDropDownPicker
      open={open}
      value={value}
      items={items}
      placeholder={placeholder}
      // Follows the app's colour scheme (constants/Colors.ts).
      theme={theme}
      onChangeValue={changeValue}
      onOpen={notifyOpenChange}
      onClose={notifyOpenChange}
      setOpen={setOpen}
      setValue={setValue}
    />
  )
}
export default DropDownPickerView
