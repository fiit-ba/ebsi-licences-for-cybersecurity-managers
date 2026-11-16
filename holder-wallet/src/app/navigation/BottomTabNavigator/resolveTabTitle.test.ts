import { TabScreenConfig } from '@shared/types/navigation'
import { resolveTabTitle } from './resolveTabTitle'

const screens = [
  {
    name: 'Credentials',
    component: () => null,
    options: { title: 'Certificates' },
  },
] as TabScreenConfig[]

describe('resolveTabTitle', () => {
  it('returns the configured title', () => {
    expect(resolveTabTitle('Credentials', screens)).toBe('Certificates')
  })

  it('falls back to the route name', () => {
    expect(resolveTabTitle('UnknownTab', screens)).toBe('UnknownTab')
  })
})
