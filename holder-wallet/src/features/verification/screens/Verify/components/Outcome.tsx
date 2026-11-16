import { useState } from 'react'
import { Text, View } from 'react-native'
import { Avatar, Button } from 'react-native-paper'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { certificateTypes, credentialTypeName } from '@shared/utils/labels'
import type { VerificationResult } from '@infrastructure/verifier/verifier.types'
import VerifyI18nKeys from '../i18n/keys'
import { outcomeStyles as styles } from './Outcome.styles'
import { OutcomeCertificate, OutcomeEvidence, OutcomeMark } from './OutcomeEvidence'
import {
  formatOutcomeDate,
  knownState,
  OUTCOME_TONES,
  stateColor,
  stateNameKey,
  TONE_ICON,
  toneColor,
  VERIFICATION_CONDITIONS,
} from './outcome.model'

export { knownState, stateColor, stateNameKey, toneColor } from './outcome.model'

const Outcome = ({ result }: { result: VerificationResult }) => {
  const { t } = useTranslation(SCREEN.Verify)
  const [details, setDetails] = useState(false)
  const state = knownState(result.outcome)
  const tone = OUTCOME_TONES[state]
  const types = certificateTypes(result.credential_types ?? [])
  const credentials = result.credentials ?? []

  return (
    <View>
      <View style={[styles.banner, { borderLeftColor: toneColor(tone) }]}>
        <Avatar.Icon size={44} icon={TONE_ICON[tone]} color="#fff" style={{ backgroundColor: toneColor(tone) }} />
        <View style={styles.bannerText}>
          <Text style={[styles.headline, { color: toneColor(tone) }]}>{t(stateNameKey(state))}</Text>
          <Text style={styles.code}>{state}</Text>
        </View>
      </View>
      <Text style={styles.body}>{t(`${stateNameKey(state)}_TEXT`)}</Text>
      {types.length > 0 && <Text style={styles.types}>{types.map(credentialTypeName).join(', ')}</Text>}
      <Text style={styles.muted}>
        {t(VerifyI18nKeys.VERIFIED_AT)}: {formatOutcomeDate(result.created_at)}
      </Text>

      {credentials.map((credential, index) => (
        <OutcomeCertificate
          key={index}
          credential={credential}
          heading={
            credentials.length > 1 ? t(VerifyI18nKeys.CERTIFICATE_N, { n: index + 1, count: credentials.length }) : ''
          }
          attributesUntil={result.attributes_until}
        />
      ))}

      <Button mode="text" onPress={() => setDetails(!details)} style={styles.toggle}>
        {t(details ? VerifyI18nKeys.HIDE_DETAILS : VerifyI18nKeys.SHOW_DETAILS)}
      </Button>

      {details && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t(VerifyI18nKeys.CONDITIONS)}</Text>
            <Text style={styles.muted}>{t(VerifyI18nKeys.CONDITIONS_HINT)}</Text>
            {VERIFICATION_CONDITIONS.map((key) => (
              <View key={key} style={styles.condition}>
                <OutcomeMark value={result.checks?.[key]} />
                <Text style={styles.conditionLabel}>{t(`COND_${key}`)}</Text>
              </View>
            ))}
          </View>
          {credentials.map((credential, index) => (
            <OutcomeEvidence
              key={index}
              credential={credential}
              heading={
                credentials.length > 1
                  ? t(VerifyI18nKeys.CERTIFICATE_N, { n: index + 1, count: credentials.length })
                  : ''
              }
            />
          ))}
        </>
      )}
    </View>
  )
}

export default Outcome
