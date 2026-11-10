import { Dispatch, SetStateAction } from 'react'

export interface DropDownPickerProps {
  items: { label: string; value: string }[]
  onChange: (value: any, open?: boolean) => void
  onChangeOpen?: (open: boolean) => void
  placeholder?: string
}

export interface DropDownPickerViewProps extends DropDownPickerProps {
  open: boolean
  value: any
  theme: 'DARK' | 'LIGHT'
  setOpen: Dispatch<SetStateAction<boolean>>
  setValue: Dispatch<SetStateAction<any>>
  changeValue: (value: any) => void
  notifyOpenChange: () => void
}
