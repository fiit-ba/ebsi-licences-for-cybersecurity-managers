import { RefObject } from 'react'
import { StateWrapperRef } from '@shared/components/wrappers/StateWrapper/type'
import { ActionLog } from '@infrastructure/openid/types'
import { RootTabScreenProps } from '@app/navigation/types'

export type HistoricalScreenProps = RootTabScreenProps<'Historical'>

export interface HistoricalScreenViewProps {
  childRef: RefObject<StateWrapperRef | null>
  loadHistory: () => Promise<ActionLog[]>
  placeholderTitle: string
  placeholderText: string
}
