type StoredCallback = (...params: unknown[]) => unknown

const callbackFunctions: Record<string, StoredCallback> = {}

export function storeCallbackFunction<Params extends unknown[]>(id: string, callback: (...params: Params) => unknown) {
  callbackFunctions[id] = (...params) => callback(...(params as Params))
}

export function getCallbackFunction(id: string) {
  return callbackFunctions[id]
}

export function deleteCallbackFunction(id: string) {
  delete callbackFunctions[id]
}

export function executeCallbackFunction(id: string, params: unknown[] = []) {
  const callback = callbackFunctions[id]
  if (!callback) return undefined
  return callback(...params)
}
