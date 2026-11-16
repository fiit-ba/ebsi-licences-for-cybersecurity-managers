import { View } from 'react-native'
import { List } from 'react-native-paper'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import CredentialStyled from './component.styles'
import PdfGenerator from '@features/credentials/components/PdfGenerator'
import CredentialAccordionDetail from '@features/credentials/components/CredentialAccordionDetail'
import Loading from '@shared/components/Loading'
import { CredentialDetailViewProps } from './component.types'

const CredentialDetailView = ({
  itemKey,
  issuer,
  credential,
  expanded,
  loading,
  currentStatus,
  needsAttention,
  displayCertificateTitle,
  reference,
  formattedIssueDate,
  formattedExpDate,
  isExpired,
  displayCredentialType,
  trustedFramework,
  issuedAt,
  validFrom,
  expiresAt,
  additionalInfo,
  primaryColor,
  errorColor,
  labels,
  handlePress,
}: CredentialDetailViewProps) => (
  <CredentialStyled.CredentialDetailContainer $attention={needsAttention}>
    <List.Section key={itemKey} style={{ width: '100%', marginVertical: 0 }}>
      <CredentialStyled.StyledAccordion
        left={(iconProps) => (
          <List.Icon
            {...iconProps}
            icon={needsAttention ? 'file-alert-outline' : 'file-certificate-outline'}
            color={needsAttention ? errorColor : primaryColor}
          />
        )}
        title={displayCertificateTitle}
        description={
          <View>
            {reference && (
              <CredentialStyled.MetadataText>
                <CredentialStyled.LabelText>{labels.reference}</CredentialStyled.LabelText>
                {reference}
              </CredentialStyled.MetadataText>
            )}
            <CredentialStyled.MetadataText>
              <CredentialStyled.LabelText>{labels.issuanceDate}</CredentialStyled.LabelText> {formattedIssueDate}
            </CredentialStyled.MetadataText>
            <CredentialStyled.MetadataText>
              <CredentialStyled.LabelText>{labels.expires}</CredentialStyled.LabelText>
              <CredentialStyled.ExpirationText isExpired={isExpired}>
                {formattedExpDate}
              </CredentialStyled.ExpirationText>
            </CredentialStyled.MetadataText>
            {(currentStatus === 'Suspended' || currentStatus === 'Revoked') && (
              <CredentialStyled.MetadataText>
                <CredentialStyled.LabelText>{labels.state}</CredentialStyled.LabelText>
                <DescriptionText style={{ color: errorColor, fontWeight: 'bold' }}>
                  {currentStatus === 'Suspended' ? labels.suspended : labels.revoked}
                </DescriptionText>
              </CredentialStyled.MetadataText>
            )}
          </View>
        }
        titleNumberOfLines={0}
        descriptionNumberOfLines={0}
        expanded={expanded}
        onPress={handlePress}
      >
        {loading && (
          <CredentialStyled.LoadingContainer>
            <Loading size="small" />
          </CredentialStyled.LoadingContainer>
        )}
        <CredentialStyled.ExpandedContent style={{ paddingLeft: 0 }}>
          <CredentialAccordionDetail
            type={displayCredentialType}
            organization={issuer}
            trustedFramework={trustedFramework}
            issuanceDate={issuedAt}
            validFrom={validFrom}
            expirationDate={expiresAt}
            status={currentStatus}
            additionalInfo={additionalInfo}
          />
          <CredentialStyled.PdfActionContainer>
            <PdfGenerator data={credential} />
          </CredentialStyled.PdfActionContainer>
        </CredentialStyled.ExpandedContent>
      </CredentialStyled.StyledAccordion>
    </List.Section>
  </CredentialStyled.CredentialDetailContainer>
)

export default CredentialDetailView
