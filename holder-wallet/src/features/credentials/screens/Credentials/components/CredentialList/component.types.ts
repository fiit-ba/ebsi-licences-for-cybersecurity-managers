import { RefObject } from 'react'
import { FlatList } from 'react-native'
import { CredentialData } from '@infrastructure/openid/types'

export interface CredentialListProps {
  credentials: CredentialData[]
}

export interface CredentialListViewProps {
  credentials: CredentialData[]
  listRef: RefObject<FlatList<CredentialData> | null>
  showFooter: boolean
  showCard: (index: number) => void
  loadMore: () => void
}
