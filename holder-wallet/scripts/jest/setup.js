// Keeps Wallet component timers deterministic; asynchronous effects are flushed explicitly with act in tests.
jest.useFakeTimers()
// Renders app icon families as inert text so component tests do not start asynchronous font loading.
jest.mock('@expo/vector-icons', () => {
  const React = require('react')
  const { Text } = require('react-native')
  const MockIcon = React.forwardRef((_props, ref) => React.createElement(Text, { ref }))
  MockIcon.font = {}
  return {
    __esModule: true,
    default: MockIcon,
    AntDesign: MockIcon,
    FontAwesome: MockIcon,
    MaterialIcons: MockIcon,
  }
})
// Keeps React Native Paper's MaterialCommunityIcons inert for the same component-test boundary.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const React = require('react')
  const { Text } = require('react-native')
  const MockIcon = React.forwardRef((_props, ref) => React.createElement(Text, { ref }))
  MockIcon.font = {}
  return { __esModule: true, default: MockIcon }
})
// Avoids loading the native Libsodium JSI installer in Jest; native crypto requires separate device/vector tests.
jest.mock('react-native-libsodium', () => ({
  __esModule: true,
  default: { ready: Promise.resolve() },
}))
// Skips React Native shim installation in Node, whose equivalent APIs are already provided by Jest's runtime.
jest.mock('@ethersproject/shims', () => ({}))
// Maps the native quick-crypto API to Node crypto so tests run without an on-device JSI runtime.
jest.mock('react-native-quick-crypto', () => {
  const crypto = require('node:crypto')
  return { __esModule: true, default: crypto, ...crypto }
})
// Supplies the Base64 helpers used by the migrated crypto stack in the Jest environment.
jest.mock('react-native-quick-base64', () => ({
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  fromByteArray: (value) => Buffer.from(value).toString('base64'),
  toByteArray: (value) => Uint8Array.from(Buffer.from(value, 'base64')),
}))
// Replaces the native clipboard module with inert Jest functions for component tests.
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { getString: jest.fn(), setString: jest.fn() },
  useClipboard: () => ['', jest.fn()],
}))
// Makes wallet derivation deterministic without loading native Ethereum key bindings.
jest.mock('ethereumjs-wallet', () => {
  const wallet = {
    getPrivateKeyString: jest.fn(() => '0x' + '01'.repeat(32)),
    getPublicKey: jest.fn(() => Buffer.alloc(64)),
  }
  const derived = { getWallet: jest.fn(() => wallet) }
  const key = { derivePath: jest.fn(() => derived), getWallet: jest.fn(() => wallet) }
  const hdkey = {
    fromMasterSeed: jest.fn(() => key),
    fromExtendedKey: jest.fn(() => key),
  }
  return { __esModule: true, default: function Wallet() {}, hdkey }
})
// Stabilizes generated identifiers and BIP39 values used by snapshots and wallet-flow tests.
jest.mock('uuid', () => ({ v4: jest.fn(() => '00000000-0000-4000-8000-000000000000') }))
jest.mock('@dreson4/react-native-quick-bip39', () => ({
  generateMnemonic: jest.fn(
    () => 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  ),
  mnemonicToSeedSync: jest.fn(() => Buffer.alloc(64)),
  validateMnemonic: jest.fn(() => true),
}))
const localStorageMock = function () {
  let store = {}

  return {
    getItem(key) {
      return store[key]
    },

    setItem(key, value) {
      store[key] = value
    },

    clear() {
      store = {}
    },

    removeItem(key) {
      delete store[key]
    },

    getAll() {
      return store
    },
  }
}
const storageCache = {}
// Provides the current AsyncStorage module shape while preserving the existing in-memory test store.
const mockAsyncStorage = localStorageMock()
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
  ...mockAsyncStorage,
}))
// Supplies deterministic safe-area components and dimensions without native providers.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react')
  const { View } = require('react-native')
  return {
    SafeAreaProvider: ({ children }) => React.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  }
})
// Models Expo Camera permissions and CameraView after replacing expo-barcode-scanner.
jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  },
  CameraView: 'CameraView',
}))
// Prevents PDF and share tests from invoking their native implementations.
jest.mock('react-native-html-to-pdf', () => ({
  generatePDF: jest.fn(async () => ({ filePath: '/tmp/test.pdf' })),
}))
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { open: jest.fn(async () => ({})) },
}))
// Exposes the i18next methods used by the migrated components without initializing localization.
jest.mock('i18next', () => ({
  addResourceBundle: jest.fn(),
  getFixedT: () => (key) => key,
  t: (key) => key,
  language: 'sk',
  changeLanguage: jest.fn(),
  use: () => {
    class MockClass {
      constructor() {}

      init() {}
    }
    return new MockClass()
  },
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key, // Simula la función de traducción t()
  }),
}))
jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native')
  return {
    ...actualNav,
    useFocusEffect: jest.fn(),
    useNavigation: () => ({
      navigate: jest.fn(),
      dispatch: jest.fn(),
    }),
  }
})
// The exchange's TCP server and the phone's Wi-Fi address have no native side
// in Jest (design decisions D33); the exchange itself is tested without a socket.
jest.mock('react-native-tcp-socket', () => ({ __esModule: true, default: { createServer: jest.fn() } }))
jest.mock('expo-network', () => ({ getIpAddressAsync: jest.fn(async () => '192.168.1.50') }))
