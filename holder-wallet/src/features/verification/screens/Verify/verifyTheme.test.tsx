import { fireEvent, render } from '@testing-library/react-native'
import { Button } from 'react-native-paper'
import VerifyScreenView from '@features/verification/screens/Verify/VerifyScreenView'
import { VerifyScreenViewProps } from '@features/verification/screens/Verify/screen.types'
import { VerificationRequest } from '@infrastructure/verifier/verifier.types'

const violet = '#6D28D9'

const props: VerifyScreenViewProps = {
  phase: {
    kind: 'waiting',
    request: {
      state: 'request-state',
      qr: 'data:image/png;base64,AA==',
    } as VerificationRequest,
    expiresAt: '16:31',
  },
  qrSide: 280,
  primaryColor: violet,
  warningColor: '#B45309',
  errorColor: '#C62828',
  recordNote: '',
  labels: {
    offlineScan: 'Scan holder QR',
    offlineHint: 'Direct verification',
    connecting: 'Connecting',
    intro: 'Ask the holder to scan',
    qr: 'Verification QR',
    waiting: 'Waiting',
    newRequest: 'New request',
    expired: 'Expired',
    declined: 'The holder declined',
    retry: 'Retry',
    verifyAnother: 'Verify another',
  },
  start: jest.fn(async () => undefined),
  retry: jest.fn(),
  openOfflineScanner: jest.fn(),
}

describe('<VerifyScreenView /> organization accent', () => {
  it('applies the active profile accent to every verification action', () => {
    const screen = render(<VerifyScreenView {...props} />)
    const buttons = screen.UNSAFE_getAllByType(Button)

    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.props.buttonColor === violet)).toBe(true)
  })
})

describe('<VerifyScreenView /> verifying without the server', () => {
  const phases: VerifyScreenViewProps['phase'][] = [
    { kind: 'starting' },
    { kind: 'error', message: 'The request could not be created. The server is unreachable.' },
    { kind: 'expired' },
  ]

  it.each(phases)("offers scanning the holder's QR code while $kind", (phase) => {
    const openOfflineScanner = jest.fn()
    const screen = render(<VerifyScreenView {...props} phase={phase} openOfflineScanner={openOfflineScanner} />)
    fireEvent.press(screen.getByText('Scan holder QR'))
    expect(openOfflineScanner).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Direct verification')).toBeTruthy()
  })

  it('says what it waits for while reaching the verification service', () => {
    const screen = render(<VerifyScreenView {...props} phase={{ kind: 'starting' }} />)
    expect(screen.getByText('Connecting')).toBeTruthy()
  })
})

describe('<VerifyScreenView /> a declined request', () => {
  it('says the holder declined and offers a new request', () => {
    const start = jest.fn(async () => undefined)
    const screen = render(<VerifyScreenView {...props} phase={{ kind: 'declined' }} start={start} />)
    expect(screen.getByText('The holder declined')).toBeTruthy()
    fireEvent.press(screen.getByText('New request'))
    expect(start).toHaveBeenCalledTimes(1)
  })
})
