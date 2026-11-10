import { useContext, useMemo, useRef, useState } from 'react'
import { FlatList } from 'react-native'
import { useTranslation } from 'react-i18next'
import { MessageContext } from '@app/context/UserMessage.context'
import { SCREEN } from '@shared/constants/screens'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { revokePresentations } from '@infrastructure/persistence/keychain'
import { PresentationData } from '@infrastructure/openid/types'
import PresentationsI18nKeys from '../../i18n/keys'
import { PresentationListProps, PresentationListViewProps } from './component.types'

const ITEMS_PER_PAGE = 10

const usePresentationList = ({ presentations }: PresentationListProps): PresentationListViewProps => {
  const { t } = useTranslation(SCREEN.Presentations)
  const [pageNumber, setPageNumber] = useState(1)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [hiddenItems, setHiddenItems] = useState<string[]>([])
  const [deleteMode, setDeleteMode] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)
  const listRef = useRef<FlatList<PresentationData>>(null)
  const { showMessage } = useContext(MessageContext)
  const activePresentations = useMemo(
    () => presentations.filter((item) => item.status === 'Active' && !hiddenItems.includes(String(item.timestamp))),
    [hiddenItems, presentations],
  )
  const totalPages = Math.ceil(activePresentations.length / ITEMS_PER_PAGE)
  const visiblePresentations = activePresentations.slice(0, pageNumber * ITEMS_PER_PAGE)
  const allSelected =
    activePresentations.length > 0 &&
    activePresentations.every(({ timestamp }) => selectedItems.includes(String(timestamp)))

  const revoke = async () => {
    if (!selectedItems.length || isRevoking) return
    setIsRevoking(true)
    let revokedItems: string[] = []
    let failedCount = 0
    try {
      revokedItems = await revokePresentations(selectedItems)
      failedCount = selectedItems.length - revokedItems.length
    } catch {
      failedCount = selectedItems.length
    }
    setHiddenItems((current) => [...new Set([...current, ...revokedItems])])
    setSelectedItems((current) => current.filter((item) => !revokedItems.includes(item)))
    setIsRevoking(false)
    if (revokedItems.length) showMessage({ content: t(PresentationsI18nKeys.SUCCESS_MESSAGE), type: 'success' })
    if (failedCount) showMessage({ content: t(PresentationsI18nKeys.ERROR_MESSAGE), type: 'error' })
    else {
      setDeleteMode(false)
      setSelectedItems([])
    }
  }

  return {
    presentations: visiblePresentations,
    listRef,
    selectedItems,
    setSelectedItems,
    deleteMode,
    isRevoking,
    allSelected,
    activeCount: activePresentations.length,
    primaryColor: getThemeColor(ColorKeys.primary),
    buttonTextColor: getThemeColor(ColorKeys.buttonText),
    revokeColor: getThemeColor(selectedItems.length ? ColorKeys.error : ColorKeys.disabled),
    labels: {
      title: t(PresentationsI18nKeys.ACTIVE_PRESENTATIONS),
      count: t(PresentationsI18nKeys.ACTIVE_COUNT, { count: activePresentations.length }),
      manage: t(PresentationsI18nKeys.MANAGE),
      selected: t(PresentationsI18nKeys.SELECTED_COUNT, { count: selectedItems.length }),
      selectAll: t(PresentationsI18nKeys.SELECT_ALL),
      allSelected: t(PresentationsI18nKeys.ALL_SELECTED),
      cancel: t(PresentationsI18nKeys.CANCEL),
      revoke: t(PresentationsI18nKeys.REVOKE),
      empty: t(PresentationsI18nKeys.NO_ACTIVE_PRESENTATIONS),
    },
    enterDeleteMode: () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
      setDeleteMode(true)
    },
    leaveDeleteMode: () => {
      setSelectedItems([])
      setDeleteMode(false)
    },
    selectAll: () => setSelectedItems(activePresentations.map(({ timestamp }) => String(timestamp))),
    revoke,
    loadMore: () => {
      if (pageNumber < totalPages) setPageNumber((current) => current + 1)
    },
  }
}
export default usePresentationList
