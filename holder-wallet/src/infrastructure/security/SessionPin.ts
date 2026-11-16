let pin: string | null = null

export const SessionPin = {
  set(value: string): void {
    pin = value
  },
  get(): string {
    return pin ?? ''
  },
  clear(): void {
    pin = null
  },
}
