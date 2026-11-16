import { RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { render } from '@testing-library/react-native'
import SecurityPhrase from '@features/recovery/screens/SecurityPhrase'
import { RootStackParamList } from '@app/navigation/types'

type ScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SecurityPhrase'>

type SecurityPhraseRouteProp = RouteProp<RootStackParamList, 'SecurityPhrase'>

const mockedNavigation: ScreenNavigationProp | any = {
  navigate: jest.fn(),
}

const mockedRoute: SecurityPhraseRouteProp = {
  key: 'mocked-key',
  name: 'SecurityPhrase',
  params: {
    mneumonic: 'mocked-mnemonic',
    derivationPath: 'mocked-derivation-path',
  },
}

describe('SecurityPhrase screen', () => {
  it('should render SecurityPhrase screen', () => {
    const result = render(<SecurityPhrase navigation={mockedNavigation} route={mockedRoute} />)

    expect(result.toJSON()).toMatchSnapshot()
  })
  it('Should renders items correctly', () => {
    const { getAllByRole, getByTestId } = render(<SecurityPhrase navigation={mockedNavigation} route={mockedRoute} />)

    const title = getByTestId('title')
    const continueBtn = getAllByRole('button')

    expect(title).toBeDefined()
    expect(continueBtn).toBeDefined()
  })
})
