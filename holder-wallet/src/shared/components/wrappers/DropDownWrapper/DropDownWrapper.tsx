import DropDownWrapperView from './DropDownWrapperView'
import useDropDownWrapper from './useDropDownWrapper'
import { DropDownWrapperProps } from './component.types'

const DropDownWrapper = (props: DropDownWrapperProps) => <DropDownWrapperView {...useDropDownWrapper(props)} />
export default DropDownWrapper
