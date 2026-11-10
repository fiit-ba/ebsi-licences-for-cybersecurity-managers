import { useEffect, useState } from 'react'
import { Linking } from 'react-native'

interface Props {
  onHandleUrl: (url: string) => void
  currentScreen: string
}
// The launch link is handled once. It stays Linking.getInitialURL()
// for the life of the process, so every later sign-in re-opened an offer that
// had already been redeemed. A link arriving while the app runs is a new tap
// and is handled each time (navigation/index.tsx).
const handledUrls = new Set<string>()

export const claimUrl = (url: string | null | undefined): boolean => {
  if (!url || handledUrls.has(url)) return false
  handledUrls.add(url)
  return true
}

const useDeepLinking = (props: Props) => {
  const [data, setData] = useState<any>()
  const useMount = (func: () => void) => useEffect(() => func(), [])
  useMount(() => {
    const getUrlAsync = async () => {
      const initialUrl = await Linking.getInitialURL()
      claimUrl(initialUrl) && handleUrl(initialUrl!)
    }
    props.currentScreen === 'Login' && getUrlAsync()
  })
  // Links arriving while the app runs are handled once, globally, in
  // navigation/index.tsx - including on the tab screens, which no wrapper
  // covers. The per-screen listener used to call removeAllListeners('url') on
  // unmount, which also removed every other screen's, so a warm link was lost.

  const handleUrl = (url: string) => {
    const data = props.onHandleUrl?.(url)
    setData(data)
  }
  return data
}

export default useDeepLinking
