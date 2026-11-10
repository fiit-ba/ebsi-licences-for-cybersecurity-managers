import 'react-native-get-random-values'
import { install } from 'react-native-quick-crypto'

// Install the Node/Web Crypto and Buffer globals before modules such as jose
// are evaluated. This keeps the crypto runtime identical on iOS and Android.
install()
