import { TabScreenConfig } from '@shared/types/navigation'

export const resolveTabTitle = (routeName: string, screens: TabScreenConfig[]): string => {
  const screen = screens.find(({ name }) => name === routeName)
  const options = screen?.options

  if (options && typeof options !== 'function' && 'title' in options && options.title !== undefined) {
    return String(options.title)
  }

  return routeName
}
