// Certificates that cannot be presented now are listed but not selectable,
// "all" selects only those that can, and one requested certificate is a single choice.
import { useEffect, useMemo, useState } from 'react'
import { View } from '@shared/components/Themed'
import RequestPresentationModalStyled from '@features/presentations/components/RequestPresentationModal/component.styles'
import ItemCredential from '@features/presentations/components/RequestPresentationModal/components/ItemCredential'
import HeaderCredential from '@features/presentations/components/RequestPresentationModal/components/HeaderCredential'
import { CredentialData } from '@infrastructure/openid/types'
import { useTranslation } from 'react-i18next'
import requestPresentationModalI18nKeys from '@features/presentations/components/RequestPresentationModal/i18n/keys'

interface Props {
  credentials: CredentialData[]
  onChangeSelectedCredentials: (s: string[]) => void
  // Per credential, whether it can be presented now, and why not.
  availability?: Record<string, { usable: boolean; note?: string }>
  // The number of credentials the verifier's input descriptors require.
  requiredCount: number
}
const CredentialList = (props: Props) => {
  const { t } = useTranslation('RequestPresentationModal')
  const [credentialsSelected, setCredentialsSelected] = useState<string[]>([])
  const usable = useMemo(
    () => props.credentials.filter(({ id }) => props.availability?.[id]?.usable ?? true),
    [props.availability, props.credentials],
  )
  const single = props.requiredCount === 1
  // Drops a selection if a live status update makes the certificate unavailable.
  useEffect(() => {
    const usableIds = new Set(usable.map(({ id }) => id))
    const next = credentialsSelected.filter((id) => usableIds.has(id)).slice(0, props.requiredCount)
    if (next.length !== credentialsSelected.length || next.some((id, index) => id !== credentialsSelected[index])) {
      setCredentialsSelected(next)
      props.onChangeSelectedCredentials(next)
    }
  }, [credentialsSelected, props.onChangeSelectedCredentials, props.requiredCount, usable])

  const updateSelection = (next: string[]) => {
    setCredentialsSelected(next)
    props.onChangeSelectedCredentials(next)
  }

  const onHandlePressHeaderCheckBox = () => {
    updateSelection(isAllSelected ? [] : usable.map(({ id }) => id).slice(0, props.requiredCount))
  }
  const onHandlePressItem = (credential: CredentialData, isCredentialSelected: boolean) => {
    if (single) {
      // A radio selection stays selected when pressed again. The close button
      // remains the explicit way to decline the request.
      updateSelection([credential.id])
      return
    }
    if (isCredentialSelected) {
      updateSelection(credentialsSelected.filter((id) => id !== credential.id))
    } else if (credentialsSelected.length < props.requiredCount) {
      updateSelection([...credentialsSelected, credential.id])
    }
  }
  // Counts only the certificates that can be presented now; a single choice
  // has no select-all header.
  const isAllSelected: boolean = usable.length > 0 && credentialsSelected?.length === usable.length

  return (
    // Fills its container, so the list scrolls in the room the screen has (styles.ts).
    <View style={{ flex: 1 }}>
      {!single && usable.length > 1 && usable.length === props.requiredCount && (
        <HeaderCredential isCheck={isAllSelected} onPressCheckBox={onHandlePressHeaderCheckBox} />
      )}
      {!single && (
        <RequestPresentationModalStyled.SelectionSummary>
          {t(requestPresentationModalI18nKeys.SELECTED_COUNT, {
            selected: credentialsSelected.length,
            required: props.requiredCount,
          })}
        </RequestPresentationModalStyled.SelectionSummary>
      )}
      <RequestPresentationModalStyled.ScrollContainer
        contentContainerStyle={{ paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {props.credentials.map((credential: CredentialData) => {
          const isCredentialSelected = !!credentialsSelected.find((id) => id === credential.id)
          const availability = props.availability?.[credential.id]

          return (
            <ItemCredential
              key={credential.id}
              credential={credential}
              onPress={() => {
                onHandlePressItem(credential, isCredentialSelected)
              }}
              isChecked={isCredentialSelected}
              selectionMode={single ? 'single' : 'multiple'}
              // Shows a certificate that cannot be presented as disabled,
              // with the reason.
              disabled={availability ? !availability.usable : false}
              selectionLocked={!single && !isCredentialSelected && credentialsSelected.length >= props.requiredCount}
              note={availability?.note}
            />
          )
        })}
      </RequestPresentationModalStyled.ScrollContainer>
    </View>
  )
}

export default CredentialList
