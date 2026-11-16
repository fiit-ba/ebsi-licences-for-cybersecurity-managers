import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { getDidList } from '@infrastructure/persistence/keychain'
import useEbsiDid from '@shared/hooks/useEbsiDid'
import DidListI18nKeys from './i18n/keys'
import { DidEntry, DidListScreenViewProps } from './screen.types'
const useDidListScreen = (): DidListScreenViewProps => {
  const { t } = useTranslation(SCREEN.DidList)
  const [didList, setDidList] = useState<DidEntry[]>([])
  const [isCreatingDid, setIsCreatingDid] = useState(false)
  const ensureEbsiDid = useEbsiDid()
  const loadDidList = async () => setDidList((await getDidList()) as DidEntry[])
  useEffect(() => {
    void loadDidList()
  }, [])
  const createDid = async () => {
    setIsCreatingDid(true)
    try {
      if (await ensureEbsiDid()) await loadDidList()
    } finally {
      setIsCreatingDid(false)
    }
  }
  return {
    didList,
    isCreatingDid,
    createDid: () => {
      void createDid()
    },
    labels: {
      copy: t(DidListI18nKeys.PRESS_TO_COPY),
      hint: t(DidListI18nKeys.WALLET_DID_HINT),
      empty: t(DidListI18nKeys.NO_DID_CREATED),
      add: t(DidListI18nKeys.ADD_NEW_DID),
    },
  }
}
export default useDidListScreen
