// Loads every Expo icon font still used after removing manual native font linking.
import { AntDesign, FontAwesome, MaterialIcons } from '@expo/vector-icons'
import * as Font from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
// Imports Inter, the wallet's typeface (src/constants/fontFamily.ts).
import { FONT_FACES } from '@shared/constants/fontFamily'
import { restoreLanguage } from '@app/localization/Language'
// Whether this is an organization's wallet (design decisions D15).
import { restoreOrganization } from '@infrastructure/organization/OrganizationService'
// The certificate schemas' names (domain/credentials/schemaCatalog.ts).
import { refreshSchemaNames, restoreSchemaNames } from '@infrastructure/credentials/schemaCatalog.repository'

export default function useCachedResources() {
  const [isLoadingComplete, setLoadingComplete] = useState(false)

  // Load any resources or data that we need prior to rendering the app
  useEffect(() => {
    async function loadResourcesAndDataAsync() {
      try {
        SplashScreen.preventAutoHideAsync()
        // Load fonts
        await Font.loadAsync({
          // Registers the icon fonts explicitly before any migrated icon component renders.
          ...AntDesign.font,
          ...FontAwesome.font,
          ...MaterialIcons.font,
          // Inter, every weight (constants/fontFamily.ts).
          ...FONT_FACES,
        })
        // The language the holder chose last time (app/localization/Language.ts).
        await restoreLanguage()
        // The organization's profile, if the app has one, and which profile
        // it shows: the organization's opens in its colours (D18).
        await restoreOrganization()
        // The kept schema names at once; the current ones in the background,
        // so a slow or absent back-office never holds up the start.
        await restoreSchemaNames()
        refreshSchemaNames()
      } catch (e) {
        // We might want to provide this error information to an error reporting service
        console.error(e)
      } finally {
        setLoadingComplete(true)
        SplashScreen.hideAsync()
      }
    }

    loadResourcesAndDataAsync()
  }, [])

  return isLoadingComplete
}
