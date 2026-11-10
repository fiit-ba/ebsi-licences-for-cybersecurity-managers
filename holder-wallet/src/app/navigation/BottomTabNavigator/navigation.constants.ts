export const TAB_CONTENT_HEIGHT = 56

const MIN_TAB_BOTTOM_INSET = 8
const MAX_TAB_BOTTOM_INSET = 20
// Taller than any gesture area (an iPhone's home indicator is 34): Android's
// three-button bar (48), which draws over whatever lies beneath it.
const BUTTON_BAR_INSET = 40

export const compactBottomInset = (nativeInset: number): number =>
  nativeInset >= BUTTON_BAR_INSET
    ? nativeInset
    : Math.min(Math.max(nativeInset, MIN_TAB_BOTTOM_INSET), MAX_TAB_BOTTOM_INSET)
