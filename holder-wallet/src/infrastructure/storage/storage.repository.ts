import { asyncStorageAdapter } from './asyncStorage.adapter'
const storageOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch {
    throw new Error('ERROR_STORAGE')
  }
}
export const storageRepository = {
  store: (key: string, value: string) => storageOperation(() => asyncStorageAdapter.set(key, value)),
  get: (key: string) => storageOperation(() => asyncStorageAdapter.get(key)),
  remove: (key: string) => storageOperation(() => asyncStorageAdapter.remove(key)),
  clear: () => storageOperation(() => asyncStorageAdapter.clear()),
}
