import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { render } from '@testing-library/react-native'
// The lock leaves the app when going back (design decisions D28).
import { BackHandler } from 'react-native'
import Login from '@features/authentication/screens/Login'
import { RootStackParamList } from '@app/navigation/types'
// Provides a stable message context without exercising provider state in Login component tests.
import { MessageContext } from '@app/context/UserMessage.context'

type ScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>

const mockedNavigation: ScreenNavigationProp | any = {
  navigate: jest.fn(),
  // Mocks the current navigator replace method used during login.
  replace: jest.fn(),
  route: jest.fn(),
  // Keeps the listeners Login adds, so a test can play the navigator's events.
  addListener: jest.fn((name: string, listener: (event: any) => void) => {
    listeners[name] = listener
    return jest.fn()
  }),
}
const listeners: Record<string, (event: any) => void> = {}
// Centralizes rendering with current route props and inert message callbacks.
const renderLogin = (params?: object) =>
  render(
    <MessageContext.Provider
      value={{
        messageInfo: { content: '', type: 'success', isVisible: false },
        showMessage: jest.fn(),
        setMessageInfo: jest.fn(),
      }}
    >
      <Login navigation={mockedNavigation} route={{ key: 'Login-test', name: 'Login', params } as any} />
    </MessageContext.Provider>,
  )

describe('Login screen', () => {
  it('should render login screen', () => {
    const result = renderLogin()

    expect(result.toJSON()).toMatchSnapshot()
  })
  it('Should renders items correctly', () => {
    const { getAllByRole, getByTestId } = renderLogin()

    const title = getByTestId('title')
    const startBtn = getAllByRole('button')
    const recoverButton = getAllByRole('button')

    expect(title).toBeDefined()
    expect(startBtn).toBeDefined()
    expect(recoverButton).toBeDefined()
  })
  // The lock over the open wallet: the system back button removed it and
  // showed the certificates behind it without the PIN (design decisions D28).
  describe('as the lock over the open wallet', () => {
    const leave = (type: string) => {
      const event = { data: { action: { type } }, preventDefault: jest.fn() }
      listeners.beforeRemove(event)
      return event
    }
    let exitApp: jest.SpyInstance
    beforeEach(() => {
      exitApp = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined)
    })
    afterEach(() => exitApp.mockRestore())

    it('is not backed out of: back leaves the app instead', () => {
      renderLogin({ locked: true })
      expect(leave('GO_BACK').preventDefault).toHaveBeenCalled()
      expect(exitApp).toHaveBeenCalled()
    })

    it('lets unlocking take the user on', () => {
      renderLogin({ locked: true })
      expect(leave('NAVIGATE').preventDefault).not.toHaveBeenCalled()
    })

    it('is left as before when it is no lock', () => {
      renderLogin()
      expect(leave('GO_BACK').preventDefault).not.toHaveBeenCalled()
      expect(exitApp).not.toHaveBeenCalled()
    })
  })
})
