import RequestPresentationModalStyled from '@features/presentations/components/RequestPresentationModal/component.styles'
import { Checkbox, RadioButton } from 'react-native-paper'
import { CredentialData } from '@infrastructure/openid/types'
import { getThemeColor, ColorKeys } from '@shared/constants/Colors'
import { getTimeFormat } from '@shared/utils/dates'
import { filterCredentialType } from '@infrastructure/openid/utils'
import { useTranslation } from 'react-i18next'
import requestPresentationModalI18nKeys from '@features/presentations/components/RequestPresentationModal/i18n/keys'
import { View } from 'react-native'

interface Props {
  credential: CredentialData
  onPress: () => void
  isChecked: boolean
  selectionMode: 'single' | 'multiple'
  // Cannot be presented now - greyed out and not selectable - and why.
  disabled?: boolean
  selectionLocked?: boolean
  note?: string
}
const ItemCredential = ({ credential, onPress, isChecked, selectionMode, disabled, selectionLocked, note }: Props) => {
  const bundleName = 'RequestPresentationModal'
  const { t } = useTranslation(bundleName)

  const { validFrom, issuer, expirationDate } = credential
  const { type, credentialSubject } = credential?.credential?.payload.vc
  // The certificate number, so two certificates of one type can be told apart.
  const number = (credentialSubject as any)?.certificateNumber
  const formattedExpDate = expirationDate ? getTimeFormat(expirationDate) : t(requestPresentationModalI18nKeys.NEVER)
  const credentialName = filterCredentialType(type).join(', ')
  const interactionDisabled = !!disabled || !!selectionLocked

  return (
    // The full card is the touch target. A one-descriptor request uses a radio
    // control; checkbox semantics are reserved for requests that require a set.
    <RequestPresentationModalStyled.ItemContainer
      $selected={isChecked}
      $disabled={!!disabled}
      onPress={onPress}
      disabled={interactionDisabled}
      accessibilityRole={selectionMode === 'single' ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: isChecked, disabled: interactionDisabled }}
      accessibilityLabel={`${credentialName}${number ? `, ${t(requestPresentationModalI18nKeys.NUMBER)} ${number}` : ''}`}
    >
      {/*
          The certificate greyed out, its reason not - that is what the holder needs to read. */}
      <RequestPresentationModalStyled.ItemControl>
        {selectionMode === 'single' ? (
          <RadioButton.Android
            color={getThemeColor(ColorKeys.primary)}
            uncheckedColor={getThemeColor(ColorKeys.placeholder)}
            value={credential.id}
            status={isChecked ? 'checked' : 'unchecked'}
            onPress={onPress}
            disabled={interactionDisabled}
          />
        ) : (
          <Checkbox.Android
            color={getThemeColor(ColorKeys.primary)}
            uncheckedColor={getThemeColor(ColorKeys.placeholder)}
            status={isChecked ? 'checked' : 'unchecked'}
            onPress={onPress}
            disabled={interactionDisabled}
          />
        )}
      </RequestPresentationModalStyled.ItemControl>
      <RequestPresentationModalStyled.Container>
        <View style={disabled ? { opacity: 0.45 } : undefined}>
          <RequestPresentationModalStyled.CardTopRow>
            <RequestPresentationModalStyled.CardTitle>{credentialName}</RequestPresentationModalStyled.CardTitle>
            {/*
                Shows the certificate number and the reason a row cannot be chosen. */}
            {number ? (
              <RequestPresentationModalStyled.NumberBadge>
                <RequestPresentationModalStyled.NumberText>
                  № {String(number)}
                </RequestPresentationModalStyled.NumberText>
              </RequestPresentationModalStyled.NumberBadge>
            ) : null}
          </RequestPresentationModalStyled.CardTopRow>
          <RequestPresentationModalStyled.DateRow>
            <RequestPresentationModalStyled.DateColumn>
              <RequestPresentationModalStyled.MetaLabel>
                {t(requestPresentationModalI18nKeys.VALID_FROM)}
              </RequestPresentationModalStyled.MetaLabel>
              <RequestPresentationModalStyled.MetaValue>
                {getTimeFormat(validFrom)}
              </RequestPresentationModalStyled.MetaValue>
            </RequestPresentationModalStyled.DateColumn>
            <RequestPresentationModalStyled.DateColumn>
              <RequestPresentationModalStyled.MetaLabel>
                {t(requestPresentationModalI18nKeys.EXPIRATION_DATE)}
              </RequestPresentationModalStyled.MetaLabel>
              <RequestPresentationModalStyled.MetaValue>{formattedExpDate}</RequestPresentationModalStyled.MetaValue>
            </RequestPresentationModalStyled.DateColumn>
          </RequestPresentationModalStyled.DateRow>
          <RequestPresentationModalStyled.MetaLabel>
            {t(requestPresentationModalI18nKeys.ORGANIZATION)}
          </RequestPresentationModalStyled.MetaLabel>
          <RequestPresentationModalStyled.IssuerValue numberOfLines={1} ellipsizeMode="middle">
            {issuer}
          </RequestPresentationModalStyled.IssuerValue>
        </View>
        {note ? (
          <RequestPresentationModalStyled.StatusNote
            color={disabled ? getThemeColor(ColorKeys.error) : getThemeColor(ColorKeys.placeholder)}
          >
            {note}
          </RequestPresentationModalStyled.StatusNote>
        ) : null}
      </RequestPresentationModalStyled.Container>
    </RequestPresentationModalStyled.ItemContainer>
  )
}

export default ItemCredential
