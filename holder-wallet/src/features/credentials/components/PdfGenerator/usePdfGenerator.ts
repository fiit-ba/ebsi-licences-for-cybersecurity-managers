import { useState } from 'react'
import { Platform } from 'react-native'
import { generatePDF as createPDF } from 'react-native-html-to-pdf'
import Share from 'react-native-share'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import PDFGeneratorI18nKeys from './i18n/keys'
import localeSK from './i18n/sk'
import localeEN from './i18n/en'
import { PdfGeneratorProps, PdfGeneratorViewProps } from './component.types'

const usePdfGenerator = ({ data }: PdfGeneratorProps): PdfGeneratorViewProps => {
  const bundle = 'PDFGenerator'
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const [isDialogVisible, setDialogVisible] = useState(false)
  const generatePDF = async () => {
    try {
      const formattedData = JSON.stringify(data, null, 2)
      const html = `<html><head><style>body { font-family: Arial, sans-serif; } code { white-space: pre-wrap; }</style></head><body><code>${formattedData.replace(/\n/g, '<br>')}</code></body></html>`
      const pdf = await createPDF({
        html,
        fileName: 'Credential',
        ...(Platform.OS === 'ios' && { directory: 'Documents' as const }),
      })
      return pdf.filePath
    } catch (error) {
      console.error('Error generating PDF:', error)
    }
  }
  const share = async () => {
    setDialogVisible(false)
    const pdfUri = await generatePDF()
    if (pdfUri) {
      try {
        await Share.open({
          url: `file://${pdfUri}`,
          type: 'application/pdf',
          // Closing the native share sheet is a normal user action, not an error.
          failOnCancel: false,
        })
      } catch (error) {
        console.error('Error sharing PDF:', error)
      }
    }
  }
  return {
    isDialogVisible,
    buttonLabel: t(PDFGeneratorI18nKeys.BUTTON_GENERATE),
    dialogTitle: t(PDFGeneratorI18nKeys.DIALOG_TITLE),
    dialogDescription: t(PDFGeneratorI18nKeys.DIALOG_DESCRIPTION),
    showDialog: () => setDialogVisible(true),
    share,
    hideDialog: () => setDialogVisible(false),
  }
}
export default usePdfGenerator
