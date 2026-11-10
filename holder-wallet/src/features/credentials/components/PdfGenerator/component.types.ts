export interface PdfGeneratorProps {
  data: any
}

export interface PdfGeneratorViewProps {
  isDialogVisible: boolean
  buttonLabel: string
  dialogTitle: string
  dialogDescription: string
  showDialog: () => void
  share: () => Promise<void>
  hideDialog: () => void
}
