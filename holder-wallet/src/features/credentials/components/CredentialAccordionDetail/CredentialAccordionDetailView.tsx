// Slovak bundle; a suspended credential is shown apart from a revoked one (component 1.1).
import React from 'react'
// Removes the Spanish strings: the wallet offers Slovak and English.
import { Icon } from 'react-native-paper'
import {
  Container,
  CopyHintRow,
  CopyHintText,
  LabelText,
  Row,
  SectionHeader,
  SectionTitle,
  ValueText,
  copyableValueStyle,
} from '@features/credentials/components/CredentialAccordionDetail/component.styles'
import AccordionDetailI18nKeys from '@features/credentials/components/CredentialAccordionDetail/i18n/keys'
import { getTimeFormat } from '@shared/utils/dates'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
// Imports the colours, to show a certificate that does not hold in the error
// colour.
// Slovak labels for the credential's claims, in the order a certificate
// states them, and their values with dates in the holder's form.
import { claimLabel, claimValue, inClaimOrder } from '@shared/utils/labels'
import PressToCopy from '@shared/components/PressToCopy'

interface CopyableValueProps {
  value: string
  label: string
  numberOfLines?: number
  color?: string
  testID?: string
}

// One value renderer is used for every field, so truncation never destroys
// access to the underlying credential data: a long press always copies the
// complete formatted value on both Android and iOS.
const CopyableValue = ({ value, label, numberOfLines = 1, color, testID }: CopyableValueProps) => (
  <PressToCopy value={value} testID={testID} style={copyableValueStyle} accessibilityLabel={`${label} ${value}`}>
    <ValueText $color={color} numberOfLines={numberOfLines} ellipsizeMode="tail">
      {value}
    </ValueText>
  </PressToCopy>
)

import { CredentialAccordionDetailViewProps } from './component.types'

const CredentialAccordionDetailView: React.FC<CredentialAccordionDetailViewProps> = ({
  id,
  type,
  organization,
  trustedFramework,
  issuanceDate,
  validFrom,
  expirationDate,
  status,
  additionalInfo,
  t,
  translatedStatus,
  mutedColor,
  errorColor,
}) => {
  const statusLabel = String(t(AccordionDetailI18nKeys.STATUS))

  return (
    <Container>
      <CopyHintRow>
        <Icon source="gesture-tap-hold" size={15} color={mutedColor} />
        <CopyHintText>{t(AccordionDetailI18nKeys.COPY_HINT)}</CopyHintText>
      </CopyHintRow>

      {id && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.ID)}</LabelText>
          <CopyableValue
            value={id}
            label={String(t(AccordionDetailI18nKeys.ID))}
            numberOfLines={2}
            testID="credential-value-id"
          />
        </Row>
      )}
      {type && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.CREDENTIAL)}</LabelText>
          <CopyableValue
            value={type.join(', ')}
            label={String(t(AccordionDetailI18nKeys.CREDENTIAL))}
            numberOfLines={2}
          />
        </Row>
      )}
      {organization && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.ORGANIZATION)}</LabelText>
          <CopyableValue
            value={organization}
            label={String(t(AccordionDetailI18nKeys.ORGANIZATION))}
            testID="credential-value-organization"
          />
        </Row>
      )}
      {trustedFramework && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.TRUSTED_FRAMEWORK)}</LabelText>
          <CopyableValue value={trustedFramework} label={String(t(AccordionDetailI18nKeys.TRUSTED_FRAMEWORK))} />
        </Row>
      )}
      {issuanceDate && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.ISSUANCE_DATE)}</LabelText>
          <CopyableValue value={getTimeFormat(issuanceDate)} label={String(t(AccordionDetailI18nKeys.ISSUANCE_DATE))} />
        </Row>
      )}
      {validFrom && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.VALID_FROM)}</LabelText>
          <CopyableValue value={getTimeFormat(validFrom)} label={String(t(AccordionDetailI18nKeys.VALID_FROM))} />
        </Row>
      )}
      {expirationDate && (
        <Row>
          <LabelText>{t(AccordionDetailI18nKeys.VALID_UNTIL)}</LabelText>
          <CopyableValue value={getTimeFormat(expirationDate)} label={String(t(AccordionDetailI18nKeys.VALID_UNTIL))} />
        </Row>
      )}

      <Row>
        <LabelText>{t(AccordionDetailI18nKeys.STATUS)}</LabelText>
        <CopyableValue
          value={translatedStatus}
          label={statusLabel}
          color={status === 'Revoked' || status === 'Suspended' ? errorColor : undefined}
        />
      </Row>

      {/* Additional Info Section */}
      {additionalInfo && Object.keys(additionalInfo).length > 0 && (
        <>
          <SectionHeader>
            {/*
                Uses a translated heading instead of the hard-coded Spanish one. */}
            <SectionTitle>{t(AccordionDetailI18nKeys.ADDITIONAL_INFO)}</SectionTitle>
          </SectionHeader>
          {/*
              The claims in the certificate's order, not the credential's alphabetical one. */}
          {inClaimOrder(Object.entries(additionalInfo)).map(([key, value]) => {
            const label = claimLabel(key)
            const formattedValue = claimValue(value)

            return (
              // Long claims stay compact but retain their complete copyable value.
              <Row key={key}>
                <LabelText>
                  {label}
                  {': '}
                </LabelText>
                <CopyableValue
                  value={formattedValue}
                  label={label}
                  numberOfLines={2}
                  testID={`credential-claim-${key}`}
                />
              </Row>
            )
          })}
        </>
      )}
    </Container>
  )
}

export default CredentialAccordionDetailView
