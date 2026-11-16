import { Checkbox, Icon } from 'react-native-paper'
import PresentationStyled from './component.styles'
import { PresentationDetailViewProps } from './component.types'
// A presentation card represents one disclosure event. Reusing a certificate
// therefore creates another card, but the event has its own time, verifier and
// VP identifier instead of looking like an accidental duplicate.
const PresentationDetailView = ({
  deleteMode,
  selected,
  expanded,
  legacy,
  title,
  presentedAtLabel,
  verifierLabel,
  presentationId,
  verifier,
  networks,
  credentialCount,
  primaryColor,
  mutedColor,
  labels,
  onPress,
}: PresentationDetailViewProps) => {
  return (
    <PresentationStyled.PresentationDetailContainer $selected={selected}>
      <PresentationStyled.CardHeader
        onPress={onPress}
        accessibilityRole={deleteMode ? 'checkbox' : 'button'}
        accessibilityState={deleteMode ? { checked: selected } : { expanded }}
        accessibilityLabel={title}
      >
        {deleteMode && (
          <PresentationStyled.CheckBoxView pointerEvents="none">
            <Checkbox.Android status={selected ? 'checked' : 'unchecked'} color={primaryColor} />
          </PresentationStyled.CheckBoxView>
        )}
        <PresentationStyled.IconCircle>
          <Icon source="file-certificate-outline" size={23} color={primaryColor} />
        </PresentationStyled.IconCircle>
        <PresentationStyled.CardSummary>
          <PresentationStyled.CardTitle numberOfLines={2} ellipsizeMode="tail">
            {title}
          </PresentationStyled.CardTitle>
          <PresentationStyled.CardMeta>{presentedAtLabel}</PresentationStyled.CardMeta>
          {verifierLabel && !legacy ? (
            <PresentationStyled.CardMeta numberOfLines={1} ellipsizeMode="middle">
              {labels.verifier}: {verifierLabel}
            </PresentationStyled.CardMeta>
          ) : (
            <PresentationStyled.LegacyBadge>
              <PresentationStyled.LegacyText>{labels.legacy}</PresentationStyled.LegacyText>
            </PresentationStyled.LegacyBadge>
          )}
        </PresentationStyled.CardSummary>
        {!deleteMode && <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={24} color={mutedColor} />}
      </PresentationStyled.CardHeader>

      {expanded && !deleteMode && (
        <PresentationStyled.DetailsContainer>
          <PresentationStyled.DetailsTitle>{labels.details}</PresentationStyled.DetailsTitle>
          <PresentationStyled.DetailRow>
            <PresentationStyled.DetailLabel>{labels.presentationId}</PresentationStyled.DetailLabel>
            <PresentationStyled.DetailValue selectable numberOfLines={3} ellipsizeMode="middle">
              {presentationId || '—'}
            </PresentationStyled.DetailValue>
          </PresentationStyled.DetailRow>
          <PresentationStyled.DetailRow>
            <PresentationStyled.DetailLabel>{labels.verifier}</PresentationStyled.DetailLabel>
            <PresentationStyled.DetailValue selectable numberOfLines={3} ellipsizeMode="middle">
              {verifier || labels.legacy}
            </PresentationStyled.DetailValue>
          </PresentationStyled.DetailRow>
          <PresentationStyled.DetailRow>
            <PresentationStyled.DetailLabel>{labels.network}</PresentationStyled.DetailLabel>
            <PresentationStyled.DetailValue>{networks.join(', ') || '—'}</PresentationStyled.DetailValue>
          </PresentationStyled.DetailRow>
          <PresentationStyled.DetailRow>
            <PresentationStyled.DetailLabel>{labels.sharedCertificates}</PresentationStyled.DetailLabel>
            <PresentationStyled.DetailValue>{String(credentialCount)}</PresentationStyled.DetailValue>
          </PresentationStyled.DetailRow>
        </PresentationStyled.DetailsContainer>
      )}
    </PresentationStyled.PresentationDetailContainer>
  )
}

export default PresentationDetailView
