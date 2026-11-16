import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { claimLabel, claimValue, inClaimOrder } from '@shared/utils/labels'
import type { CredentialEvidence } from '@infrastructure/verifier/verifier.types'
import VerifyI18nKeys from '../i18n/keys'
import { outcomeMutedColor, outcomeStyles as styles } from './Outcome.styles'
import { formatOutcomeDate as when, stateColor, stateNameKey, toneColor } from './outcome.model'

export const OutcomeMark = ({ value }: { value?: boolean | null }) => (
  <Text
    style={[
      styles.mark,
      { color: value === true ? toneColor('ok') : value === false ? toneColor('err') : outcomeMutedColor },
    ]}
  >
    {value === true ? '✓' : value === false ? '✗' : '—'}
  </Text>
)

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, mono && styles.mono]} selectable>
      {value}
    </Text>
  </View>
)

const CertificationBodyRows = ({ body }: { body?: CredentialEvidence['certification_body'] }) => {
  const { t } = useTranslation(SCREEN.Verify)
  if (!body) return null
  if (!body.recorded)
    return <Row label={t(VerifyI18nKeys.CERTIFICATION_BODY)} value={t(VerifyI18nKeys.ACCREDITED_AT_ISSUANCE_UNKNOWN)} />
  return (
    <>
      <Row label={t(VerifyI18nKeys.CERTIFICATION_BODY)} value={body.name} />
      <Row
        label={t(VerifyI18nKeys.ACCREDITED_AT_ISSUANCE)}
        value={t(
          body.accredited_at_issuance
            ? VerifyI18nKeys.ACCREDITED_AT_ISSUANCE_YES
            : VerifyI18nKeys.ACCREDITED_AT_ISSUANCE_NO,
        )}
      />
      {body.revoked_at ? (
        <Text style={styles.muted}>
          {t(
            body.revoked_organization_kind === 'tao'
              ? VerifyI18nKeys.ACCREDITATION_REVOKED_TAO
              : VerifyI18nKeys.ACCREDITATION_REVOKED,
            { date: when(body.revoked_at), organization: body.revoked_organization ?? '' },
          )}
        </Text>
      ) : !body.in_force_now && body.accredited_until ? (
        <Text style={styles.muted}>
          {t(VerifyI18nKeys.ACCREDITATION_ENDED_SINCE, { date: when(body.accredited_until) })}
        </Text>
      ) : null}
    </>
  )
}

export const OutcomeCertificate = ({
  credential,
  heading,
  attributesUntil,
}: {
  credential: CredentialEvidence
  heading: string
  attributesUntil: string | null
}) => {
  const { t } = useTranslation(SCREEN.Verify)
  const attributes = inClaimOrder(Object.entries(credential.attributes ?? {})).filter(([key]) => key !== 'id')
  const hidden =
    credential.checks?.signature_valid === false
      ? VerifyI18nKeys.ATTRIBUTES_BAD_SIGNATURE
      : credential.checks?.holder_bound === false
        ? VerifyI18nKeys.ATTRIBUTES_NOT_HOLDER
        : credential.checks?.signature_valid
          ? VerifyI18nKeys.ATTRIBUTES_GONE
          : VerifyI18nKeys.ATTRIBUTES_NOT_REACHED
  return (
    <View style={styles.card}>
      {heading !== '' && (
        <View style={styles.cardHeading}>
          <Text style={styles.cardTitle}>{heading}</Text>
          <Text style={[styles.badge, { color: stateColor(credential.state) }]}>
            {t(stateNameKey(credential.state))}
          </Text>
        </View>
      )}
      <Text style={styles.sectionTitle}>{t(VerifyI18nKeys.PRESENTED_DATA)}</Text>
      {attributes.length > 0 ? (
        <>
          {attributes.map(([key, value]) => (
            <Row key={key} label={claimLabel(key)} value={claimValue(value)} />
          ))}
          {attributesUntil && (
            <Text style={styles.muted}>{t(VerifyI18nKeys.ATTRIBUTES_UNTIL, { time: when(attributesUntil) })}</Text>
          )}
        </>
      ) : (
        <Text style={styles.muted}>{t(hidden)}</Text>
      )}
      <View style={styles.divider} />
      <Row label={t(VerifyI18nKeys.VALID_FROM)} value={when(credential.valid_from)} />
      <Row label={t(VerifyI18nKeys.VALID_UNTIL)} value={when(credential.valid_until)} />
      <Row label={t(VerifyI18nKeys.ISSUER)} value={credential.issuer || '—'} mono />
      <CertificationBodyRows body={credential.certification_body} />
    </View>
  )
}

export const OutcomeEvidence = ({ credential, heading }: { credential: CredentialEvidence; heading: string }) => {
  const { t } = useTranslation(SCREEN.Verify)
  const role = (value: string) =>
    value === 'TI' ? t(VerifyI18nKeys.ROLE_TI) : value === 'root' ? t(VerifyI18nKeys.ROLE_ROOT) : value
  const standing = (value?: string | null) =>
    value && `STANDING_${value}` in VerifyI18nKeys
      ? t(VerifyI18nKeys[`STANDING_${value}` as keyof typeof VerifyI18nKeys])
      : '—'
  const ledger = credential.ledger
  return (
    <View style={styles.card}>
      {heading !== '' && <Text style={styles.cardTitle}>{heading}</Text>}
      <Text style={styles.sectionTitle}>{t(VerifyI18nKeys.TRUST_CHAIN)}</Text>
      {credential.trust_chain?.length ? (
        [...credential.trust_chain]
          .reverse()
          .map((link) => <Row key={link.did} label={role(link.role)} value={link.did} mono />)
      ) : (
        <Text style={styles.muted}>{t(VerifyI18nKeys.NOT_EVALUATED)}</Text>
      )}
      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>{t(VerifyI18nKeys.LEDGER)}</Text>
      {ledger ? (
        <>
          <Row label={t(VerifyI18nKeys.LEDGER_STANDING)} value={standing(ledger.standing)} />
          {ledger.certificate_number ? (
            <Row label={t(VerifyI18nKeys.LEDGER_NUMBER)} value={ledger.certificate_number} />
          ) : null}
          <Row label={t(VerifyI18nKeys.LEDGER_REGISTERED)} value={when(ledger.registered_at)} />
          <Row label={t(VerifyI18nKeys.LEDGER_CHANGED)} value={when(ledger.changed_at)} />
          <Row label={t(VerifyI18nKeys.LEDGER_CONTRACT)} value={ledger.contract} mono />
        </>
      ) : (
        <Text style={styles.muted}>{t(VerifyI18nKeys.NOT_EVALUATED)}</Text>
      )}
    </View>
  )
}
