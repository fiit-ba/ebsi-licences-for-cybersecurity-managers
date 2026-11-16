import Placeholder from '@shared/components/Placeholder'
import StateWrapper from '@shared/components/wrappers/StateWrapper'
import PresentationList from '@features/presentations/screens/Presentations/components/PresentationList'
import PresentationStyled from '@features/presentations/screens/Presentations/screen.styles'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { PresentationsScreenViewProps } from './screen.types'

const PresentationsScreenView = ({
  childRef,
  loadPresentations,
  placeholderTitle,
  placeholderText,
  scanQrLabel,
  openScanner,
}: PresentationsScreenViewProps) => {
  return (
    <PresentationStyled.ContentView>
      <PresentationStyled.ScanAction>
        <ButtonStyled
          testID="presentations-scan-qr"
          icon="qrcode-scan"
          accessibilityLabel={scanQrLabel}
          onPress={openScanner}
        >
          {scanQrLabel}
        </ButtonStyled>
      </PresentationStyled.ScanAction>
      <StateWrapper
        ref={childRef}
        initialFunction={loadPresentations}
        emptyStateCondition={(presentations) => !presentations.length}
        renderEmptyState={<Placeholder placeholderTitle={placeholderTitle} placeholderText={placeholderText} />}
        renderData={(presentations) => <PresentationList presentations={presentations} />}
      />
    </PresentationStyled.ContentView>
  )
}

export default PresentationsScreenView
