import { registerRootComponent } from 'expo'
// Installs crypto polyfills before the application and its dependencies are evaluated.
import './src/polyfills'

import App from './App'

registerRootComponent(App)
