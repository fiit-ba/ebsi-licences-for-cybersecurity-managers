import moment from 'moment'
import { Icon } from 'react-native-paper'
import Colors, { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import type { ActionLog } from '@infrastructure/openid/types'
import HistoricalStyled from './component.styles'
import historicalI18nKeys from '@features/history/screens/Historical/i18n/keys'
import { stateColor } from '@features/verification/screens/Verify/components/Outcome'
import { HistoricalDetailViewProps } from './component.types'

type Appearance = {
  messageKey: keyof typeof historicalI18nKeys
  icon: string
  color: string
}
// Every history action has a semantically matching Material Community icon and
// state colour. These are decorative status marks, not misleading icon buttons.
export const historyActionAppearance = (action?: ActionLog['actionType'], outcome?: string): Appearance => {
  switch (action) {
    case 'Credential added':
      return {
        messageKey: 'CREDENTIAL_ADDED',
        icon: 'file-certificate-outline',
        color: getThemeColor(ColorKeys.primary),
      }
    case 'Credential expired':
      return { messageKey: 'CREDENTIAL_EXPIRED', icon: 'calendar-remove-outline', color: Colors.warning }
    case 'Presentation emitted':
      return { messageKey: 'PRESENTATION_EMITTED', icon: 'send-check-outline', color: getThemeColor(ColorKeys.primary) }
    case 'Credential revoked':
      return { messageKey: 'CREDENTIAL_REVOKED', icon: 'file-cancel-outline', color: getThemeColor(ColorKeys.error) }
    case 'Credential suspended':
      return { messageKey: 'CREDENTIAL_SUSPENDED', icon: 'pause-circle-outline', color: Colors.warning }
    case 'Credential reinstated':
      return {
        messageKey: 'CREDENTIAL_REINSTATED',
        icon: 'file-restore-outline',
        color: getThemeColor(ColorKeys.success),
      }
    case 'Presentation revoked':
      return { messageKey: 'PRESENTATION_REVOKED', icon: 'link-off', color: getThemeColor(ColorKeys.error) }
    case 'Certificate verified':
      return { messageKey: 'CERTIFICATE_VERIFIED', icon: 'shield-check-outline', color: stateColor(outcome) }
    case 'Certificate issued':
      return { messageKey: 'CERTIFICATE_ISSUED', icon: 'certificate-outline', color: getThemeColor(ColorKeys.primary) }
    default:
      return { messageKey: 'DEFAULT_MESSAGE', icon: 'history', color: getThemeColor(ColorKeys.mutedText) }
  }
}

const formatHistoryDate = (value: Date | string): string => {
  const raw = String(value)
  const parsed = /^\d{10}$/.test(raw) ? moment.unix(Number(raw)) : moment(value)
  if (!parsed.isValid()) return raw

  const hasTime = parsed.hours() !== 0 || parsed.minutes() !== 0 || parsed.seconds() !== 0
  return parsed.format(hasTime ? 'DD/MM/YYYY · HH:mm' : 'DD/MM/YYYY')
}

const HistoricalDetailView = ({
  date,
  issuer,
  outcome,
  kind,
  appearance,
  message,
  resultLabel,
  outcomeLabel,
  kindLabel,
  issuerLabel,
  issuerCopyHint,
  mutedColor,
  copyIssuer,
}: HistoricalDetailViewProps) => {
  return (
    <HistoricalStyled.HistoricalDetailContainer accessibilityLabel={message}>
      <HistoricalStyled.IconColumn>
        <HistoricalStyled.IconCircle $color={appearance.color}>
          <Icon source={appearance.icon} size={23} color={appearance.color} />
        </HistoricalStyled.IconCircle>
      </HistoricalStyled.IconColumn>

      <HistoricalStyled.HistoryContent>
        <HistoricalStyled.HistoryTitle>{message}</HistoricalStyled.HistoryTitle>

        {outcome && (
          <HistoricalStyled.InfoRow>
            <HistoricalStyled.InfoLabel>{resultLabel}</HistoricalStyled.InfoLabel>
            <HistoricalStyled.OutcomeBadge $color={stateColor(outcome)}>
              <HistoricalStyled.OutcomeText $color={stateColor(outcome)}>{outcomeLabel}</HistoricalStyled.OutcomeText>
            </HistoricalStyled.OutcomeBadge>
          </HistoricalStyled.InfoRow>
        )}

        {kind && (
          <HistoricalStyled.InfoRow>
            <HistoricalStyled.InfoLabel>{kindLabel}</HistoricalStyled.InfoLabel>
            <HistoricalStyled.InfoValue numberOfLines={2} ellipsizeMode="tail">
              {kind}
            </HistoricalStyled.InfoValue>
          </HistoricalStyled.InfoRow>
        )}

        {issuer && (
          <HistoricalStyled.InfoRow>
            <HistoricalStyled.InfoLabel>{issuerLabel}</HistoricalStyled.InfoLabel>
            <HistoricalStyled.IssuerPressable
              testID="history-issuer-copy"
              accessibilityRole="button"
              accessibilityLabel={`${issuerLabel}: ${issuer}`}
              accessibilityHint={issuerCopyHint}
              delayLongPress={450}
              onLongPress={copyIssuer}
              style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
            >
              <HistoricalStyled.IssuerValue numberOfLines={1} ellipsizeMode="tail">
                {issuer}
              </HistoricalStyled.IssuerValue>
              <Icon source="content-copy" size={14} color={mutedColor} />
            </HistoricalStyled.IssuerPressable>
          </HistoricalStyled.InfoRow>
        )}

        {date && (
          <HistoricalStyled.DateRow>
            <Icon source="calendar-clock-outline" size={16} color={mutedColor} />
            <HistoricalStyled.DateText>{formatHistoryDate(date)}</HistoricalStyled.DateText>
          </HistoricalStyled.DateRow>
        )}
      </HistoricalStyled.HistoryContent>
    </HistoricalStyled.HistoricalDetailContainer>
  )
}

export default HistoricalDetailView
