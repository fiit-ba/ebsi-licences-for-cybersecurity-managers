import { FlatList } from 'react-native'
import { Button } from 'react-native-paper'
import PresentationStyled from './component.styles'
import PresentationDetail from '@features/presentations/screens/Presentations/components/PresentationDetail'
import { PresentationListViewProps } from './component.types'
// A compact toolbar and explicit selection actions replace the floating trash
// icon. Revocation is disabled until something is selected, which avoids an
// accidental destructive action on touch devices.
const PresentationListView = ({
  presentations,
  listRef,
  selectedItems,
  setSelectedItems,
  deleteMode,
  isRevoking,
  allSelected,
  activeCount,
  primaryColor,
  buttonTextColor,
  revokeColor,
  labels,
  enterDeleteMode,
  leaveDeleteMode,
  selectAll,
  revoke,
  loadMore,
}: PresentationListViewProps) => {
  return (
    <>
      {!deleteMode && (
        <PresentationStyled.Toolbar>
          <PresentationStyled.ToolbarCopy>
            <PresentationStyled.ToolbarTitle>{labels.title}</PresentationStyled.ToolbarTitle>
            <PresentationStyled.ToolbarSubtitle>{labels.count}</PresentationStyled.ToolbarSubtitle>
          </PresentationStyled.ToolbarCopy>
          {activeCount > 0 && (
            <Button
              mode="contained"
              compact
              icon="playlist-edit"
              buttonColor={primaryColor}
              textColor={buttonTextColor}
              contentStyle={{ minHeight: 38 }}
              onPress={enterDeleteMode}
            >
              {labels.manage}
            </Button>
          )}
        </PresentationStyled.Toolbar>
      )}

      {deleteMode && (
        <PresentationStyled.SelectionBar>
          <PresentationStyled.SelectionHeader>
            <PresentationStyled.SelectedCount>{labels.selected}</PresentationStyled.SelectedCount>
            {/* Keep this control mounted in both states. Removing it after the
                last item is selected changes the header height and makes the
                action row jump on compact devices. */}
            <PresentationStyled.SelectAllButton
              mode="contained"
              compact
              icon={allSelected ? 'check-all' : 'checkbox-multiple-marked-outline'}
              buttonColor={primaryColor}
              textColor={buttonTextColor}
              contentStyle={{ minHeight: 38 }}
              disabled={allSelected || isRevoking || !activeCount}
              onPress={allSelected ? undefined : selectAll}
            >
              {allSelected ? labels.allSelected : labels.selectAll}
            </PresentationStyled.SelectAllButton>
          </PresentationStyled.SelectionHeader>
          <PresentationStyled.SelectionActions>
            <PresentationStyled.SelectionActionSlot>
              <Button
                mode="contained"
                buttonColor={primaryColor}
                textColor={buttonTextColor}
                contentStyle={{ minHeight: 42 }}
                disabled={isRevoking}
                onPress={leaveDeleteMode}
              >
                {labels.cancel}
              </Button>
            </PresentationStyled.SelectionActionSlot>
            <PresentationStyled.SelectionActionSlot $withGap>
              <Button
                mode="contained"
                buttonColor={revokeColor}
                textColor={buttonTextColor}
                contentStyle={{ minHeight: 42 }}
                disabled={!selectedItems.length || isRevoking}
                loading={isRevoking}
                onPress={revoke}
              >
                {labels.revoke}
              </Button>
            </PresentationStyled.SelectionActionSlot>
          </PresentationStyled.SelectionActions>
        </PresentationStyled.SelectionBar>
      )}

      <FlatList
        ref={listRef}
        data={presentations}
        keyExtractor={(item) => `${item.id}-${String(item.timestamp)}`}
        renderItem={({ item }) => (
          <PresentationDetail
            id={item.id}
            verifier={item.verifier}
            credentialTypes={item.credentialTypes}
            credentialCount={item.credentialCount}
            legacy={item.legacy}
            itemTimestamp={item.timestamp}
            deleteMode={deleteMode}
            selectedItems={selectedItems}
            setSelectedItems={setSelectedItems}
            presentation={item.credential}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.25}
        ListFooterComponent={<PresentationStyled.ListFooter />}
        ListEmptyComponent={
          <PresentationStyled.EmptyState>
            <PresentationStyled.EmptyStateText>{labels.empty}</PresentationStyled.EmptyStateText>
          </PresentationStyled.EmptyState>
        }
        extraData={{ selectedItems, deleteMode }}
        showsVerticalScrollIndicator={false}
      />
    </>
  )
}

export default PresentationListView
