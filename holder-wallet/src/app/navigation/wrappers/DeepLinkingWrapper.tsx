// Uses React 19's component type instead of the removed global JSX namespace.
import { useEffect, type ComponentType } from 'react'
import useDeepLinking from '@shared/hooks/useDeepLinking'
import { storeCallbackFunction } from '@shared/utils/storeCallback'
import { useOpenId } from '@app/openid/useOpenId'

export const DeepLinkingWrapper = (Component: ComponentType<any>) => (props: any) => {
  const callbackId = 'SameDeviceCredentialCallback'
  const { handleCredentialOffer } = useOpenId()
  const onHandleCallback = async (encodedOpenidUri: string) => {
    await handleCredentialOffer(encodedOpenidUri)
  }
  useEffect(() => {
    storeCallbackFunction(callbackId, onHandleCallback)
  }, [])

  const onHandleUrl = async (encodedOpenidUri: string) => {
    const callback = {
      id: callbackId,
      params: [encodedOpenidUri],
    }
    // if Lockscreen is not active then must indicate here: navigation.replace('Login) so deep link works

    props.navigation.setParams({
      callback,
    })
  }
  useDeepLinking({ onHandleUrl, currentScreen: props.route.name })
  return <Component {...props} />
}
