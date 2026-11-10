import LockAppWrapper from '@app/navigation/wrappers/LockAppWrapper'
import { DeepLinkingWrapper } from '@app/navigation/wrappers/DeepLinkingWrapper'

const wrappedScreens = new Map<any, any>()

export const wrapTabScreen = (component: any) => {
  if (!wrappedScreens.has(component)) {
    wrappedScreens.set(component, DeepLinkingWrapper(LockAppWrapper(component)))
  }

  return wrappedScreens.get(component)
}
