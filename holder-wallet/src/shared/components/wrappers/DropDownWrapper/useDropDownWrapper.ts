import { useState } from 'react'
import { DropDownWrapperProps, DropDownWrapperViewProps } from './component.types'

const useDropDownWrapper = (props: DropDownWrapperProps): DropDownWrapperViewProps => {
  const [isExpanded, setIsExpanded] = useState(false)
  return { ...props, isExpanded, toggleExpanded: () => setIsExpanded((current) => !current) }
}
export default useDropDownWrapper
