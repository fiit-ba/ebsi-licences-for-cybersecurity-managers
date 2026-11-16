import { boolToString, stringToBool } from './storage.mapper'
import { storageRepository } from './storage.repository'
export default class LocalStorageService {
  public static StringToBool(value: string): boolean {
    return stringToBool(value)
  }
  public static async storeData(key: string, value: string) {
    await storageRepository.store(key, value)
  }
  public static async storeBool(key: string, value: boolean) {
    await storageRepository.store(key, boolToString(value))
  }
  public static async getData(key: string): Promise<string> {
    return (await storageRepository.get(key)) || ''
  }
  public static async getBool(key: string): Promise<boolean> {
    const value = await storageRepository.get(key)
    return value ? stringToBool(value) : false
  }
  public static async removeItem(key: string): Promise<void> {
    await storageRepository.remove(key)
  }
  public static async clearAll() {
    await storageRepository.clear()
  }
}
