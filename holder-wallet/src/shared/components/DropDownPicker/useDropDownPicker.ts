import { useEffect, useState } from 'react'
import { getAppColorScheme } from '@shared/constants/Colors'
import { DropDownPickerProps, DropDownPickerViewProps } from './component.types'

const useDropDownPicker = (props: DropDownPickerProps): DropDownPickerViewProps => {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<any>(null)

  useEffect(() => {
    if (value === null && props.items.length === 1) {
      setValue(props.items[0].value)
      props.onChange(props.items[0].value, false)
    }
  }, [props.items])

  return {
    ...props,
    open,
    value,
    theme: getAppColorScheme() === 'dark' ? 'DARK' : 'LIGHT',
    setOpen,
    setValue,
    changeValue: (nextValue) => props.onChange(nextValue, open),
    notifyOpenChange: () => props.onChangeOpen?.(!open),
  }
}
export default useDropDownPicker
