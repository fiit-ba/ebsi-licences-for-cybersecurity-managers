// Allows refresh callers to retain current content while new state is loaded.
export type StateWrapperReloadOptions = {
  /** Keep the currently rendered content visible while fresh data is loaded. */
  silent?: boolean
}

export type StateWrapperRef = {
  reload?: (options?: StateWrapperReloadOptions) => void
}
