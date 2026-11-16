import { Dispatch, RefObject, SetStateAction } from 'react'
import { FlatList } from 'react-native'
import { PresentationData } from '@infrastructure/openid/types'

export interface PresentationListProps {
  presentations: PresentationData[]
}

export interface PresentationListViewProps {
  presentations: PresentationData[]
  listRef: RefObject<FlatList<PresentationData> | null>
  selectedItems: string[]
  setSelectedItems: Dispatch<SetStateAction<string[]>>
  deleteMode: boolean
  isRevoking: boolean
  allSelected: boolean
  activeCount: number
  primaryColor: string
  buttonTextColor: string
  revokeColor: string
  labels: {
    title: string
    count: string
    manage: string
    selected: string
    selectAll: string
    allSelected: string
    cancel: string
    revoke: string
    empty: string
  }
  enterDeleteMode: () => void
  leaveDeleteMode: () => void
  selectAll: () => void
  revoke: () => Promise<void>
  loadMore: () => void
}
