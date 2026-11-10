// What of each chosen certificate the holder shares (design decisions D36). The
// verifier's DCQL query names the combinations of attributes it accepts, the one
// it prefers first (OpenID4VP 1.0, claim_sets); the holder picks one, and the
// verifier sees exactly its attributes. What a verifier checks the certificate
// by - its TI, schemas, number, validity, registry - is always shared, and the
// list says so.
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Checkbox, RadioButton } from 'react-native-paper'
import { useTranslation } from 'react-i18next'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { certificateTypeNames, claimLabel, claimValue, inClaimOrder } from '@shared/utils/labels'
import requestPresentationModalI18nKeys from '@features/presentations/components/RequestPresentationModal/i18n/keys'

export type Disclosable = {
  id: string
  types: string[]
  number?: string
  /** Every attribute any of the options shares, with its value. */
  attributes: Record<string, unknown>
  /** The attributes each option shares, in the verifier's order of preference. */
  options: string[][]
}

interface Props {
  certificates: Disclosable[]
  chosen: Record<string, number>
  onChoose: (certificateId: string, option: number) => void
}

const DisclosureList = ({ certificates, chosen, onChoose }: Props) => {
  const { t } = useTranslation('RequestPresentationModal')
  return (
    <ScrollView style={styles.scroll}>
      {certificates.map((certificate) => {
        const names = inClaimOrder(Object.entries(certificate.attributes)).map(([name]) => name)
        const sizes = certificate.options.map((option) => option.length)
        const index = chosen[certificate.id] ?? 0
        const shared = certificate.options[index] ?? certificate.options[0] ?? []
        const label = (option: string[], at: number) =>
          option.length === Math.max(...sizes)
            ? t(requestPresentationModalI18nKeys.OPTION_ALL, { count: option.length })
            : option.length === Math.min(...sizes)
              ? t(requestPresentationModalI18nKeys.OPTION_REQUIRED, { count: option.length })
              : t(requestPresentationModalI18nKeys.OPTION_OTHER, { number: at + 1, count: option.length })
        return (
          <View key={certificate.id} style={styles.card}>
            <Text style={styles.title}>{certificateTypeNames(certificate.types)}</Text>
            {certificate.number ? (
              <Text style={styles.muted}>
                {t(requestPresentationModalI18nKeys.NUMBER)} {certificate.number}
              </Text>
            ) : null}
            <Text style={styles.muted}>{t(requestPresentationModalI18nKeys.FIELDS_ALWAYS)}</Text>
            <RadioButton.Group value={String(index)} onValueChange={(value) => onChoose(certificate.id, Number(value))}>
              {certificate.options.map((option, at) => (
                <RadioButton.Item
                  key={at}
                  testID={`disclose-option-${at}`}
                  value={String(at)}
                  label={label(option, at)}
                  labelStyle={styles.label}
                  color={getThemeColor(ColorKeys.primary)}
                />
              ))}
            </RadioButton.Group>
            {names.map((name) => (
              <Checkbox.Item
                key={name}
                testID={`disclose-${name}`}
                label={`${claimLabel(name)}: ${claimValue(certificate.attributes[name])}`}
                labelStyle={styles.label}
                status={shared.includes(name) ? 'checked' : 'unchecked'}
                disabled
                color={getThemeColor(ColorKeys.primary)}
              />
            ))}
            <Text style={styles.muted}>
              {t(requestPresentationModalI18nKeys.FIELDS_COUNT, { count: shared.length, total: names.length })}
            </Text>
          </View>
        )
      })}
    </ScrollView>
  )
}

const text = { fontFamily: FONT_FAMILY.PRINCIPAL, color: getThemeColor(ColorKeys.text) }

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  card: {
    backgroundColor: getThemeColor(ColorKeys.surface),
    borderRadius: 12,
    borderWidth: 1,
    borderColor: getThemeColor(ColorKeys.border),
    padding: 12,
    marginBottom: 12,
  },
  title: { ...text, fontSize: 16, fontWeight: '700' },
  muted: { ...text, fontSize: 13, lineHeight: 18, color: getThemeColor(ColorKeys.mutedText), marginTop: 4 },
  label: { ...text, fontSize: 15 },
})

export default DisclosureList
