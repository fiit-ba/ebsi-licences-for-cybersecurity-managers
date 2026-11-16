import { RefObject } from 'react'
import { StateWrapperRef } from '@shared/components/wrappers/StateWrapper/type'
import { PresentationData } from '@infrastructure/openid/types'
import { RootTabScreenProps } from '@app/navigation/types'

export type PresentationsScreenProps = RootTabScreenProps<'Presentations'>

export interface PresentationsScreenViewProps {
  childRef: RefObject<StateWrapperRef | null>
  loadPresentations: () => Promise<PresentationData[]>
  placeholderTitle: string
  placeholderText: string
  scanQrLabel: string
  openScanner: () => void
}
