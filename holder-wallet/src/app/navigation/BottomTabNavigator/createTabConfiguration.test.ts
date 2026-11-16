import { ColorKeys } from '@shared/constants/Colors'
import { createTabConfiguration } from './createTabConfiguration'

describe('createTabConfiguration', () => {
  it('keeps the holder tab order and initial route', () => {
    const configuration = createTabConfiguration(false)

    expect(configuration.screens.map(({ name }) => name)).toEqual([
      'Credentials',
      'VerifyTab',
      'Presentations',
      'Historical',
    ])
    expect(configuration.initialTab).toBe('Credentials')
    expect(configuration.accentColorKey).toBe(ColorKeys.primary)
    expect(configuration.headerColorKey).toBe(ColorKeys.headerBackground)
  })

  it('keeps the organization tab order and initial route', () => {
    const configuration = createTabConfiguration(true)

    expect(configuration.screens.map(({ name }) => name)).toEqual(['IssueTab', 'VerifyTab', 'Historical'])
    expect(configuration.initialTab).toBe('IssueTab')
    expect(configuration.accentColorKey).toBe(ColorKeys.orgPrimary)
    expect(configuration.headerColorKey).toBe(ColorKeys.orgHeader)
  })
})
