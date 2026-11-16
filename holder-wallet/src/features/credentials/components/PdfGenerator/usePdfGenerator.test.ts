import { act, renderHook } from '@testing-library/react-native'
import Share from 'react-native-share'
import usePdfGenerator from './usePdfGenerator'

describe('usePdfGenerator', () => {
  it('treats closing the native share sheet as a normal cancellation', async () => {
    const { result } = renderHook(() => usePdfGenerator({ data: { id: 'credential-1' } }))

    await act(async () => {
      await result.current.share()
    })

    expect(Share.open).toHaveBeenCalledWith({
      url: 'file:///tmp/test.pdf',
      type: 'application/pdf',
      failOnCancel: false,
    })
  })
})
