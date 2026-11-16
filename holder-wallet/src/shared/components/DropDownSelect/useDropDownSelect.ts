import { useEffect, useMemo, useState } from 'react'
import { getBackgroundTheme } from '@shared/constants/Colors'
import { DropDownSelectProps, DropDownSelectViewProps } from './component.types'

const useDropDownSelect = (props: DropDownSelectProps): DropDownSelectViewProps => {
  const [isExpand, setIsExpand] = useState(false)
  const initialSelectedData = useMemo(
    () => Object.fromEntries(Object.keys(props.data).map((key) => [key, false])),
    [props.data],
  )
  const [selectedData, setSelectedData] = useState<Record<string, boolean>>(initialSelectedData)
  useEffect(() => {
    props.onChange?.(selectedData)
  }, [selectedData])
  return {
    ...props,
    isExpand,
    selectedData,
    theme: getBackgroundTheme(props.backgroundColor),
    setIsExpand,
    toggleItem: (key) =>
      setSelectedData({
        ...(props.multiple ? selectedData : initialSelectedData),
        [key]: !selectedData[key],
      }),
  }
}
export default useDropDownSelect
