export interface ButtonMailboxProps {
  onPress?: () => void
  actionWidth?: number
  onUpdated?: () => void
}

export interface ButtonMailboxViewProps {
  actionWidth?: number
  isLoading: boolean
  label: string
  refresh: () => Promise<void>
}
