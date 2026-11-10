import { FlatList } from 'react-native'
import type { ActionLog } from '@infrastructure/openid/types'
import HistoricalStyled from './component.styles'
import HistoricalDetail from '@features/history/screens/Historical/components/HistoricalDetail'
import { credentialTypeName } from '@shared/utils/labels'

const kindOf = (item: ActionLog): string | undefined =>
  item.data?.type ? credentialTypeName(item.data.type) : item.data?.kind

import { HistoricalListViewProps } from './component.types'
// FlatList renders history progressively without a fake loading delay. Insets
// live in the scroll content, so cards stay clear of both Android and iOS tab bars.
const HistoricalListView = ({ logs, loadMore }: HistoricalListViewProps) => {
  return (
    <HistoricalStyled.ListContainer>
      <FlatList
        data={logs}
        keyExtractor={(item, index) => `${item.actionType}-${item.id}-${String(item.date)}-${index}`}
        renderItem={({ item }) => (
          <HistoricalDetail
            date={item.date}
            title={item.actionType}
            issuer={item.issuer}
            outcome={item.data?.outcome}
            kind={kindOf(item)}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.25}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}
        ListFooterComponent={<HistoricalStyled.ListFooter />}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
    </HistoricalStyled.ListContainer>
  )
}

export default HistoricalListView
