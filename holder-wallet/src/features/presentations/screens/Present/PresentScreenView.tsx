// Presenting a certificate from the holder's own phone (design decisions D33, D34, D36).
// The wallet opens an exchange on the Wi-Fi and shows its QR code. Whoever
// scans it - another phone, the console, a relying party's system through the
// Verifier Service (D35) - sends a request, and the holder sees who asks and
// for what. The holder shares only what they choose (D36): what the verifier
// requires is locked in, everything else is theirs to tick, and nothing is
// ticked for them. What the verifier always gets is what it checks the
// certificate by - its TI, schemas, number, validity and record on the
// governance contract. The PIN confirms; the certificate leaves, with the
// chosen disclosures, in a JWT-VP signed by its binding key over the
// verifier's challenge - never by the wallet's DID, which stays on the phone
// (D34).
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native'
import { Button, Checkbox, RadioButton, TextInput } from 'react-native-paper'
import moment from 'moment'
import { certificateTypeNames, claimLabel, claimValue, inClaimOrder } from '@shared/utils/labels'
import PresentI18nKeys from '@features/presentations/screens/Present/i18n/keys'
import SafeScrollView from '@shared/components/SafeScrollView'
import { screenStyles as styles } from './screen.styles'
import type usePresentScreen from './usePresentScreen'

type PresentScreenViewProps = ReturnType<typeof usePresentScreen>

const PresentScreenView = ({
  t,
  phase,
  candidates,
  chosen,
  setChosen,
  ticked,
  setTicked,
  pin,
  setPin,
  pinError,
  chooserHeight,
  qrSide,
  certificate,
  vc,
  claims,
  choosable,
  whole,
  required,
  missing,
  disclosedNames,
  askedFor,
  others,
  candidateLabels,
  anchorFields,
  decline,
  share,
  start,
  goBack,
  primaryColor,
  errorColor,
  errorDescription,
}: PresentScreenViewProps) => {
  const row = (label: string, value: string) => (
    <View key={label} style={styles.field}>
      <View style={styles.fieldText}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue} numberOfLines={3}>
          {value}
        </Text>
      </View>
    </View>
  )
  const asked = (name: string) =>
    row(claimLabel(name), name in claims ? claimValue(claims[name]) : t(PresentI18nKeys.NOT_IN_CERTIFICATE))
  const choice = (name: string, locked: boolean) => (
    <Checkbox.Item
      key={name}
      testID={`present-field-${name}`}
      label={`${claimLabel(name)}: ${claimValue(claims[name])}`}
      labelStyle={styles.choice}
      status={locked || ticked.includes(name) ? 'checked' : 'unchecked'}
      disabled={locked}
      color={primaryColor}
      onPress={() =>
        setTicked((current: string[]) =>
          current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
        )
      }
    />
  )
  return (
    <SafeScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {phase.kind === 'starting' && <ActivityIndicator style={styles.spinner} size="large" color={primaryColor} />}

      {phase.kind === 'waiting' && (
        <>
          <Text style={styles.intro}>{t(PresentI18nKeys.INTRO)}</Text>
          <View style={[styles.qrCard, { width: qrSide, height: qrSide }]}>
            <Image
              source={{ uri: phase.qr }}
              style={styles.qr}
              resizeMode="contain"
              accessibilityLabel={String(t(PresentI18nKeys.QR_LABEL))}
            />
          </View>
          <View style={styles.waiting}>
            <ActivityIndicator color={primaryColor} />
            <Text style={styles.waitingText}>{t(PresentI18nKeys.WAITING)}</Text>
          </View>
          <Text style={styles.muted}>
            {t(PresentI18nKeys.QR_UNTIL, {
              time: moment(phase.until).format('HH:mm'),
            })}
          </Text>
        </>
      )}

      {phase.kind === 'request' && (
        <>
          <Text style={styles.title}>{t(PresentI18nKeys.REQUEST_TITLE)}</Text>
          <Text style={styles.body}>
            {t(PresentI18nKeys.REQUEST_FROM, {
              name: phase.query.verifierName || t(PresentI18nKeys.UNNAMED_VERIFIER),
            })}
          </Text>
          {phase.query.reason ? (
            <Text style={styles.body}>{t(PresentI18nKeys.REASON, { reason: phase.query.reason })}</Text>
          ) : null}
          <Text style={styles.types}>{certificateTypeNames(phase.query.types)}</Text>

          {candidates.length === 0 ? (
            <Text style={styles.notice}>{t(PresentI18nKeys.NO_CERTIFICATE)}</Text>
          ) : (
            <>
              {candidates.length > 1 && (
                <View style={styles.card}>
                  <Text style={styles.section}>{t(PresentI18nKeys.CERTIFICATE)}</Text>
                  <RadioButton.Group onValueChange={(value) => setChosen(Number(value))} value={String(chosen)}>
                    {/* A holder may have a hundred certificates: they scroll here, and what is
										    shared, the PIN and the buttons stay right below. */}
                    <ScrollView style={{ maxHeight: chooserHeight }} nestedScrollEnabled testID="present-certificates">
                      {candidates.map((candidate, index) => {
                        return (
                          <RadioButton.Item
                            key={candidate.id}
                            value={String(index)}
                            label={candidateLabels[index]}
                            color={primaryColor}
                          />
                        )
                      })}
                    </ScrollView>
                  </RadioButton.Group>
                </View>
              )}
              {whole ? (
                <>
                  <View style={styles.card}>
                    <Text style={styles.section}>{t(PresentI18nKeys.MANDATORY)}</Text>
                    <Text style={styles.muted}>{t(PresentI18nKeys.MANDATORY_HINT)}</Text>
                    {phase.query.mandatory.map(asked)}
                    {phase.query.optional.length > 0 && (
                      <>
                        <Text style={[styles.section, styles.subsection]}>{t(PresentI18nKeys.OPTIONAL)}</Text>
                        {phase.query.optional.map(asked)}
                      </>
                    )}
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.section}>{t(PresentI18nKeys.WHOLE)}</Text>
                    <Text style={styles.muted}>{t(PresentI18nKeys.WHOLE_HINT)}</Text>
                    {inClaimOrder(Object.entries(claims)).map(([name, value]) =>
                      row(claimLabel(name), claimValue(value)),
                    )}
                  </View>
                </>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.section}>{t(PresentI18nKeys.CHOOSE)}</Text>
                  <Text style={styles.muted}>{t(PresentI18nKeys.CHOOSE_HINT)}</Text>
                  {required.length > 0 && (
                    <>
                      <Text style={[styles.section, styles.subsection]}>{t(PresentI18nKeys.MANDATORY)}</Text>
                      <Text style={styles.muted}>{t(PresentI18nKeys.MANDATORY_HINT)}</Text>
                      {required.map((name: string) => choice(name, true))}
                    </>
                  )}
                  {askedFor.length > 0 && (
                    <>
                      <Text style={[styles.section, styles.subsection]}>{t(PresentI18nKeys.OPTIONAL)}</Text>
                      <Text style={styles.muted}>{t(PresentI18nKeys.OPTIONAL_HINT)}</Text>
                      {askedFor.map((name: string) => choice(name, false))}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <Text style={[styles.section, styles.subsection]}>{t(PresentI18nKeys.OTHER)}</Text>
                      <Text style={styles.muted}>{t(PresentI18nKeys.OTHER_HINT)}</Text>
                      {others.map((name: string) => choice(name, false))}
                    </>
                  )}
                  <Text style={[styles.muted, styles.subsection]}>
                    {t(PresentI18nKeys.SHARED_COUNT, { count: disclosedNames.length, total: choosable.length })}
                  </Text>
                </View>
              )}
              {missing.length > 0 && (
                <Text style={[styles.notice, { borderLeftColor: errorColor }]}>
                  {t(PresentI18nKeys.MISSING_MANDATORY, { fields: missing.map(claimLabel).join(', ') })}
                </Text>
              )}
              {vc && (
                <View style={styles.card}>
                  <Text style={styles.section}>{t(PresentI18nKeys.ALWAYS)}</Text>
                  <Text style={styles.muted}>{t(PresentI18nKeys.ALWAYS_HINT)}</Text>
                  {anchorFields.map(({ label, value }) => row(label, value))}
                </View>
              )}
              {/* Collected before D34, bound to the wallet's own DID: shown to no one. */}
              {!certificate?.issuerUri ? (
                <Text style={styles.notice}>{t(PresentI18nKeys.OWN_DID)}</Text>
              ) : (
                <>
                  <TextInput
                    testID="present-pin"
                    mode="outlined"
                    label={String(t(PresentI18nKeys.PIN))}
                    value={pin}
                    secureTextEntry
                    keyboardType="number-pad"
                    onChangeText={(value) => {
                      setPin(value.replace(/[^0-9]/g, ''))
                    }}
                    error={pinError}
                    style={styles.pin}
                  />
                  {pinError && <Text style={styles.error}>{t(PresentI18nKeys.WRONG_PIN)}</Text>}
                  <Button
                    testID="present-share"
                    mode="contained"
                    disabled={pin.length < 4}
                    onPress={() => share(phase.query)}
                    style={styles.primary}
                  >
                    {t(PresentI18nKeys.SHARE)}
                  </Button>
                </>
              )}
            </>
          )}
          <Button testID="present-decline" mode="text" onPress={decline} style={styles.secondary}>
            {t(PresentI18nKeys.DECLINE)}
          </Button>
        </>
      )}

      {phase.kind === 'sharing' && (
        <View style={styles.waiting}>
          <ActivityIndicator color={primaryColor} />
          <Text style={styles.waitingText}>{t(PresentI18nKeys.SHARING)}</Text>
        </View>
      )}

      {phase.kind === 'done' && (
        <>
          <Text style={styles.notice}>{t(phase.message)}</Text>
          <Button mode="contained" onPress={goBack} style={styles.primary}>
            {t(PresentI18nKeys.DONE)}
          </Button>
          <Button mode="text" onPress={start} style={styles.secondary}>
            {t(PresentI18nKeys.AGAIN)}
          </Button>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Text style={[styles.notice, { borderLeftColor: errorColor }]}>
            {t(phase.message)}
            {errorDescription ? `. ${errorDescription}` : ''}
          </Text>
          <Button mode="contained" onPress={start} style={styles.primary}>
            {t(PresentI18nKeys.AGAIN)}
          </Button>
        </>
      )}
    </SafeScrollView>
  )
}

export default PresentScreenView
