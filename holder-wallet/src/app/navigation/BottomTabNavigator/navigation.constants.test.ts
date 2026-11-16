import { compactBottomInset } from './navigation.constants'

describe('compactBottomInset', () => {
  it('keeps a small default gap when the platform reports no inset', () => {
    expect(compactBottomInset(0)).toBe(8)
  })

  it('preserves an ordinary platform inset', () => {
    expect(compactBottomInset(16)).toBe(16)
  })

  it('caps a tall iPhone inset so it does not become empty tab-bar space', () => {
    expect(compactBottomInset(34)).toBe(20)
  })

  it("keeps the tabs above Android's three-button navigation bar", () => {
    expect(compactBottomInset(48)).toBe(48)
  })
})
