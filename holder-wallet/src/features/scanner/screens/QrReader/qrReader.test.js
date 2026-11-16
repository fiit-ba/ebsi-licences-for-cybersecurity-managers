import React from 'react'
// Flushes the asynchronous Expo Camera permission check before asserting the rendered screen.
import { act, render } from '@testing-library/react-native'

import QrReader from '@features/scanner/screens/QrReader'
import QrCustomMarker, {
  getQrFrameGap,
  getQrMarkerSize,
} from '@features/scanner/screens/QrReader/components/QrCustomMarker'
import { useNavigation } from '@react-navigation/native'
import { StyleSheet } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
// Isolates QR rendering from LACChain's native secp256k1 implementation.
jest.mock('@infrastructure/identity/lacchain/didMatch', () => ({
  useMatchingID: () => ({ handleMatchingID: jest.fn(async () => undefined) }),
}))

describe('<QrReader />', () => {
  // Covers compact iOS/Android screens and prevents oversized tablet targets.
  it('keeps the scan target within responsive phone and tablet limits', () => {
    expect(getQrMarkerSize(320, 568)).toBe(216)
    expect(getQrMarkerSize(390, 844)).toBeCloseTo(288.6)
    expect(getQrMarkerSize(768, 1024)).toBe(320)
    expect(getQrFrameGap(568)).toBe(28)
    expect(getQrFrameGap(844)).toBeCloseTo(33.76)
    expect(getQrFrameGap(1200)).toBe(40)
  })
  // A decoded QR switches every outer guide to the success colour.
  it('shows green scan corners while the QR result is being processed', () => {
    const result = render(<QrCustomMarker isReading={true} subtitle="Scan" navigation={{ goBack: jest.fn() }} />)

    for (let index = 0; index < 4; index += 1) {
      const corner = result.getByTestId(`qr-marker-corner-${index}`)
      expect(StyleSheet.flatten(corner.props.style).borderColor).toBe(getThemeColor(ColorKeys.success))
    }
  })

  it('renders correctly', async () => {
    const navigation = { navigate: jest.fn() }
    const route = { key: 'QrReader-test', name: 'QrReader', params: {} }
    const result = render(<QrReader navigation={navigation} route={route} />)
    // Verifies the stable camera state instead of snapshotting the initial loading spinner.
    await act(async () => undefined)
    expect(result.queryByRole('progressbar')).toBeNull()
    expect(result.toJSON()).toMatchSnapshot()
  })
})
