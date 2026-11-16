import React from 'react'
import { render } from '@testing-library/react-native'

import OnBoarding from '@features/onboarding/screens/OnBoarding'
import { TEST_LABELS } from '@features/onboarding/screens/OnBoarding/constants/testLabels'

describe('<OnBoarding />', () => {
  it('renders correctly', () => {
    const navigation = { navigate: jest.fn() }
    const { getByLabelText } = render(<OnBoarding navigation={navigation} />)
    const backgroundImageComponent = getByLabelText(TEST_LABELS.BACKGROUND_IMAGE)
    expect(backgroundImageComponent).toBeDefined()
  })
})
