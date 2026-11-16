import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList } from 'react-native'
import { CredentialData } from '@infrastructure/openid/types'
import { CredentialListProps, CredentialListViewProps } from './component.types'

const ITEMS_PER_PAGE = 8

const useCredentialList = ({ credentials }: CredentialListProps): CredentialListViewProps => {
  const [isLoading, setIsLoading] = useState(false)
  const [pageNumber, setPageNumber] = useState(1)
  const totalPages = useMemo(() => Math.ceil(credentials.length / ITEMS_PER_PAGE), [credentials.length])
  const paginatedData = useMemo(() => credentials.slice(0, pageNumber * ITEMS_PER_PAGE), [credentials, pageNumber])
  const listRef = useRef<FlatList<CredentialData>>(null)
  const showCard = useCallback((index: number) => {
    setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true }), 80)
  }, [])
  const loadMore = () => {
    if (pageNumber >= totalPages) return
    setIsLoading(true)
    setTimeout(() => {
      setPageNumber((current) => current + 1)
      setIsLoading(false)
    }, 1000)
  }

  return {
    credentials: paginatedData,
    listRef,
    showFooter: isLoading && pageNumber !== totalPages,
    showCard,
    loadMore,
  }
}
export default useCredentialList
