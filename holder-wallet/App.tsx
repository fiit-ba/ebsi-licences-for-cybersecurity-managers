import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Provider as PaperProvider } from 'react-native-paper'
import useCachedResources from '@shared/hooks/useCachedResources'
import useColorScheme from '@shared/hooks/useColorScheme'
import Navigation from '@app/navigation'
import { MessageProviderWrapper } from '@app/context/UserMessage.context'
import SnackbarMessage from '@shared/components/Snackbar'
import FeatureToggleProvider from '@app/providers/ScreenWrapper'
import { ModalWrapper } from '@app/context/Modal.context'
import ModalScreen from '@shared/components/ModalScreen'
import { getPaperTheme } from '@shared/constants/paperTheme'

export default function App() {
  const isLoadingComplete = useCachedResources()
  const colorScheme = useColorScheme()

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <SafeAreaProvider>
        <FeatureToggleProvider>
          <ModalWrapper>
            <MessageProviderWrapper>
              {/*
                  Paper follows the app's scheme, not the live system one,
                  on the wallet's palette and typeface (constants/paperTheme.ts). */}
              <PaperProvider theme={getPaperTheme(colorScheme === 'dark' ? 'dark' : 'light')}>
                <Navigation colorScheme={colorScheme} />
                {/*
                    Removes the obsolete backgroundColor prop for Expo 57's status bar API. */}
                <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
                <SnackbarMessage />
                <ModalScreen />
              </PaperProvider>
            </MessageProviderWrapper>
          </ModalWrapper>
        </FeatureToggleProvider>
      </SafeAreaProvider>
    )
  }
}
