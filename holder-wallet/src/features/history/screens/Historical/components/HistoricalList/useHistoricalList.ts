import { useState } from 'react'
import { HistoricalListProps, HistoricalListViewProps } from './component.types'

const ITEMS_PER_PAGE = 12

const useHistoricalList = ({ logs }: HistoricalListProps): HistoricalListViewProps => {
  const [pageNumber, setPageNumber] = useState(1)
  const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE)
  return {
    logs: logs.slice(0, pageNumber * ITEMS_PER_PAGE),
    loadMore: () => {
      if (pageNumber < totalPages) setPageNumber((current) => current + 1)
    },
  }
}
export default useHistoricalList
