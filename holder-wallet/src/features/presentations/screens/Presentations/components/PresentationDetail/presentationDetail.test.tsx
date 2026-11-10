import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import PresentationDetail from '@features/presentations/screens/Presentations/components/PresentationDetail'

describe('<PresentationDetail />', () => {
  it('shows one disclosure event with its verifier and expandable VP identifier', () => {
    const screen = render(
      <PresentationDetail
        id="urn:uuid:presentation-one"
        verifier="https://verifier.example/request"
        credentialTypes={['CybersecurityManagerCertificate']}
        credentialCount={1}
        legacy={false}
        itemTimestamp="2026-10-08T12:13:00.000Z"
        deleteMode={false}
        selectedItems={[]}
        setSelectedItems={jest.fn()}
        presentation={{}}
      />,
    )

    const card = screen.getByRole('button')
    expect(screen.getByText(/verifier\.example/)).toBeDefined()
    expect(screen.queryByText('urn:uuid:presentation-one')).toBeNull()

    fireEvent.press(card)
    expect(screen.getByText('urn:uuid:presentation-one')).toBeDefined()
  })
})
