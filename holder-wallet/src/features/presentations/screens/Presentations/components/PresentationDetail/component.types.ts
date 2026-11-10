import { PresentationData } from '@infrastructure/openid/types'

export interface PresentationDetailProps {
  itemTimestamp: Date | string
  id?: string
  verifier?: string
  credentialTypes?: string[]
  credentialCount?: number
  legacy?: boolean
  deleteMode: boolean
  selectedItems: string[]
  setSelectedItems: (items: string[]) => void
  presentation: PresentationData | string | unknown
}

export interface PresentationDetailViewProps {
  deleteMode: boolean
  selected: boolean
  expanded: boolean
  legacy?: boolean
  title: string
  presentedAtLabel: string
  verifierLabel?: string
  presentationId?: string
  verifier?: string
  networks: string[]
  credentialCount: number
  primaryColor: string
  mutedColor: string
  labels: {
    verifier: string
    legacy: string
    details: string
    presentationId: string
    network: string
    sharedCertificates: string
  }
  onPress: () => void
}
