import Placeholder from '@shared/components/Placeholder'
import StateWrapper from '@shared/components/wrappers/StateWrapper'
import HistoricalStyled from '@features/history/screens/Historical/screen.styles'
import HistoricalList from '@features/history/screens/Historical/components/HistoricalList'
import { HistoricalScreenViewProps } from './screen.types'

const HistoricalScreenView = ({
  childRef,
  loadHistory,
  placeholderTitle,
  placeholderText,
}: HistoricalScreenViewProps) => {
  return (
    <HistoricalStyled.ContentView>
      <StateWrapper
        ref={childRef}
        initialFunction={loadHistory}
        emptyStateCondition={(logs) => !logs.length}
        renderEmptyState={<Placeholder placeholderTitle={placeholderTitle} placeholderText={placeholderText} />}
        renderData={(logs) => <HistoricalList logs={logs} />}
      />
    </HistoricalStyled.ContentView>
  )
}

export default HistoricalScreenView
