import axios from 'axios'
import { applySchemaNames } from '@domain/credentials/schemaCatalog'
import { TIMEOUT_MS, backofficeUrl, isBackofficeConfigured } from '@infrastructure/config/Backoffice'
import LocalStorageService from '@infrastructure/storage'

export const SCHEMA_NAMES_STORAGE_KEY = 'plrSchemaNames'
const SCHEMA_NAMES_PATH = '/registry/schema-names/'

export const restoreSchemaNames = async (): Promise<void> => {
  try {
    const stored = await LocalStorageService.getData(SCHEMA_NAMES_STORAGE_KEY)
    if (stored) applySchemaNames(JSON.parse(stored))
  } catch (error) {
    console.warn('[wallet] the stored schema names could not be read:', error)
  }
}

export const refreshSchemaNames = async (): Promise<void> => {
  if (!isBackofficeConfigured()) return

  try {
    const { data } = await axios.get(backofficeUrl() + SCHEMA_NAMES_PATH, { timeout: TIMEOUT_MS })
    if (!Array.isArray(data?.schemas)) return
    applySchemaNames(data.schemas)
    await LocalStorageService.storeData(SCHEMA_NAMES_STORAGE_KEY, JSON.stringify(data.schemas))
  } catch (error) {
    console.warn('[wallet] the schema names could not be refreshed:', error)
  }
}
