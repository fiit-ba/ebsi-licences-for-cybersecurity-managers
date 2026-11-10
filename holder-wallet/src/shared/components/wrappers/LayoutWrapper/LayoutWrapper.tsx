import LayoutWrapperView from './LayoutWrapperView'
import useLayoutWrapper from './useLayoutWrapper'
import { LayoutWrapperProps } from './component.types'

const LayoutWrapper = (props: LayoutWrapperProps) => <LayoutWrapperView {...useLayoutWrapper(props)} />
export default LayoutWrapper
