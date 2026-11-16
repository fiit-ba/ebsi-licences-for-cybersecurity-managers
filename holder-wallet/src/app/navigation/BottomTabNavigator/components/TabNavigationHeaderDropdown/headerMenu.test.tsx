// The header menu belongs to the open wallet: when the wallet locks, the menu and
// its delete confirmation close, so the DIDs and deleting the wallet are not
// reachable from the sign-in screen without the PIN.
import { AppState, AppStateStatus } from 'react-native'
import { Menu, Provider as PaperProvider } from 'react-native-paper'
import { act, fireEvent, render } from '@testing-library/react-native'
import ConfirmationDialog from '@shared/components/ConfirmationDialog'
import TabNavigatorHeaderDropDown from './index'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), dispatch: jest.fn() }),
  useIsFocused: () => mockFocused,
}))
jest.mock('@infrastructure/organization/OrganizationService', () => ({
  currentOrganization: () => null,
  openProfile: jest.fn(async () => true),
  deleteOrganizationProfile: jest.fn(async () => undefined),
}))
jest.mock('@infrastructure/persistence/keychain', () => ({ deleteHolderWallet: jest.fn(async () => undefined) }))
jest.mock('@shared/hooks/useModal', () => () => ({ showModal: jest.fn() }))
// Paper's provider reads the safe-area insets; the library ships this mock for Jest.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('@app/localization/Language', () => ({ otherLanguage: () => 'en', setLanguage: jest.fn() }))

const menu = () => (
  <PaperProvider>
    <TabNavigatorHeaderDropDown />
  </PaperProvider>
)
const opened = (screen: ReturnType<typeof render>) => screen.UNSAFE_getByType(Menu).props.visible
const confirming = (screen: ReturnType<typeof render>) => screen.UNSAFE_getByType(ConfirmationDialog).props.visible

describe('the header menu of a locked wallet', () => {
  beforeEach(() => {
    mockFocused = true
  })

  it('closes when the sign-in screen covers the tabs, and stays closed', () => {
    const screen = render(menu())
    fireEvent.press(screen.getAllByRole('button')[0])
    expect(opened(screen)).toBe(true)

    mockFocused = false
    screen.rerender(menu())
    expect(opened(screen)).toBe(false)

    // Unlocked again: the menu does not reopen by itself.
    mockFocused = true
    screen.rerender(menu())
    expect(opened(screen)).toBe(false)
  })

  it('closes the delete confirmation when the wallet locks', () => {
    const screen = render(menu())
    fireEvent.press(screen.getAllByRole('button')[0])
    const items = screen.UNSAFE_getAllByType(Menu.Item)
    // The last item deletes the wallet; it only asks for a confirmation.
    fireEvent.press(items[items.length - 1])
    expect(confirming(screen)).toBe(true)

    mockFocused = false
    screen.rerender(menu())
    expect(confirming(screen)).toBe(false)
  })

  it('closes when the app goes to the background, before the lock screen appears', () => {
    const listeners: ((state: AppStateStatus) => void)[] = []
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void)
      return { remove: jest.fn() } as any
    })
    const screen = render(menu())
    fireEvent.press(screen.getAllByRole('button')[0])
    expect(opened(screen)).toBe(true)

    act(() => listeners.forEach((listener) => listener('background')))
    expect(opened(screen)).toBe(false)
    spy.mockRestore()
  })
})
