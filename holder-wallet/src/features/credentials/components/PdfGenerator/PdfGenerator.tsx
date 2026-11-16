import PdfGeneratorView from './PdfGeneratorView'
import usePdfGenerator from './usePdfGenerator'
import { PdfGeneratorProps } from './component.types'

const PdfGenerator = (props: PdfGeneratorProps) => <PdfGeneratorView {...usePdfGenerator(props)} />
export default PdfGenerator
