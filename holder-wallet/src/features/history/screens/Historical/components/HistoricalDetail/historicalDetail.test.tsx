import React from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import { fireEvent, render } from '@testing-library/react-native'
import HistoricalDetail, {
  historyActionAppearance,
} from '@features/history/screens/Historical/components/HistoricalDetail'

describe('history action presentation', () => {
  it.each([
    ['Credential added', 'file-certificate-outline'],
    ['Credential expired', 'calendar-remove-outline'],
    ['Presentation emitted', 'send-check-outline'],
    ['Credential revoked', 'file-cancel-outline'],
    ['Credential suspended', 'pause-circle-outline'],
    ['Credential reinstated', 'file-restore-outline'],
    ['Presentation revoked', 'link-off'],
    ['Certificate verified', 'shield-check-outline'],
    ['Certificate issued', 'certificate-outline'],
  ] as const)('uses the correct icon for %s', (action, icon) => {
    expect(historyActionAppearance(action).icon).toBe(icon)
  })

  it('truncates long organisation identifiers visually, copies the full value and shows an exact action time', () => {
    const issuer = 'did:ebsi:zvHWX359A3CvfJnCYaAiAde-with-a-long-organisation-identifier'
    const screen = render(<HistoricalDetail title="Presentation emitted" issuer={issuer} date="2026-10-08T13:50:00" />)

    expect(screen.getByText('PRESENTATION_EMITTED')).toBeDefined()
    const issuerText = screen.getByText(issuer)
    expect(issuerText.props.numberOfLines).toBe(1)
    expect(issuerText.props.ellipsizeMode).toBe('tail')

    fireEvent(screen.getByTestId('history-issuer-copy'), 'longPress')
    expect(Clipboard.setString).toHaveBeenCalledWith(issuer)
    expect(screen.getByText('08/10/2026 · 13:50')).toBeDefined()
  })
})
