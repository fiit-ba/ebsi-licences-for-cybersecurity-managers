import { RootStackScreenProps } from '@app/navigation/types'
export type DidListScreenProps = RootStackScreenProps<'DidList'>
export type DidEntry = { network: string; entity: string; did: string }
export type DidListScreenViewProps = {
  didList: DidEntry[]
  isCreatingDid: boolean
  labels: { copy: string; hint: string; empty: string; add: string }
  createDid: () => void
}
