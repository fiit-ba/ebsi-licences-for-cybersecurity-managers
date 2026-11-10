// Every write of the wallet, announced (design decisions D31). The keychain calls
// walletChanged after each successful write; the backup listens. Kept apart so
// the keychain does not import the backup, which reads the keychain.
type Listener = () => void

const listeners = new Set<Listener>()

export const onWalletChanged = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const walletChanged = (): void => {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn('[wallet] a change listener failed:', error)
    }
  }
}
