import { ActionLog } from '@infrastructure/openid/types'

export interface HistoricalDetailProps {
  date?: Date | string
  title?: ActionLog['actionType']
  issuer?: string
  outcome?: string
  kind?: string
}

export interface HistoricalDetailViewProps extends HistoricalDetailProps {
  appearance: { icon: string; color: string }
  message: string
  resultLabel: string
  outcomeLabel?: string
  kindLabel: string
  issuerLabel: string
  issuerCopyHint: string
  mutedColor: string
  copyIssuer: () => void
}
