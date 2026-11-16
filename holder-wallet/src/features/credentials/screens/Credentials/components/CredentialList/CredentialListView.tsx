// useCallback and useRef, to scroll an opened card into view.
import { FlatList } from 'react-native'
import CredentialDetail from '@features/credentials/screens/Credentials/components/CredentialDetail'
import Loading from '@shared/components/Loading'
import { componentStyles as styles, LoadingView } from './component.styles'
import { CredentialListViewProps } from './component.types'

const CredentialListView = ({ credentials, listRef, showFooter, showCard, loadMore }: CredentialListViewProps) => {
  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={styles.content}
      data={credentials}
      // Keyed by the credential, not by its position. With an index
      // key React reuses the row that sat at that position, so a list that
      // gains or reorders an entry keeps the previous credential's component
      // state - which showed the wrong certificate's status.
      keyExtractor={(item, index) => item.id ?? item.timestamp ?? `Credential-${index}`}
      // Opening a card scrolls it into view (showCard, above).
      renderItem={({ item, index }) => (
        <CredentialDetail
          issuer={item.issuer}
          credential={item.credential}
          status={item.status}
          timestamp={item.timestamp}
          onExpand={() => showCard(index)}
        />
      )}
      // A row outside the rendered window has no measured position yet: get
      // near it by the average row height and let the list render it.
      onScrollToIndexFailed={({ index, averageItemLength }) =>
        listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.1}
      ListFooterComponent={
        showFooter ? (
          <LoadingView>
            <Loading height="-10%" />
          </LoadingView>
        ) : null
      }
      showsVerticalScrollIndicator={false}
    />
  )
}

export default CredentialListView
