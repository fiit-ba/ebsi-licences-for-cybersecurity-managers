import { ActionLog } from '@infrastructure/openid/types'

export interface HistoricalListProps {
  logs: ActionLog[]
}

export interface HistoricalListViewProps {
  logs: ActionLog[]
  loadMore: () => void
}
