// Issue a certificate: the organization's tab (design decisions D15), the
// back-office console's issuing (back-office/web/src/features/issue/IssueTab.tsx) on a phone.
// The organization fills in the certificate; the registry registers it,
// allocates its status indexes and returns an offer, shown as a QR code with
// its PIN. The holder scans it with their own wallet and enters the PIN, told
// to them separately. Issuing needs the organization's back-office session,
// which lives in memory and ends when the wallet locks; without one, the tab
// asks for the account's password first.
import { Image, ScrollView, StatusBar, Text, View } from 'react-native'
import { Button, Chip } from 'react-native-paper'
import moment from 'moment'
import { OrgButton, OrgDateField, OrgField, OrgReadOnlyField } from '@features/organization/components/Organization'
import type { Schema, SchemeField } from '@domain/organization/organization'
import { localDate } from '@shared/utils/labels'
import IssueI18nKeys from '@features/issuance/screens/Issue/i18n/keys'
import { ISSUE_SECTIONS } from './screen.constants'
import { screenStyles as styles } from './screen.styles'
import type useIssueScreen from './useIssueScreen'

type IssueScreenViewProps = ReturnType<typeof useIssueScreen>

const IssueScreenView = ({
  t,
  qrSide,
  organization,
  signedIn,
  password,
  setPassword,
  available,
  scheme,
  holderReference,
  values,
  busy,
  problemText,
  offer,
  accreditation,
  ended,
  endedDate,
  setValue,
  signInNow,
  issueNow,
  another,
  choose,
  highlight,
  label,
  hint,
  schemaName,
  locale,
  changeHolderReference,
  shareOffer,
  orgPrimaryColor,
}: IssueScreenViewProps) => {
  if (!organization) return null

  const renderField = (field: SchemeField) => {
    const fieldHint = hint(field)
    return (
      <View key={field.key}>
        {field.organization ? (
          <OrgReadOnlyField label={label(field)} value={values[field.key] ?? ''} {...highlight(field.key)} />
        ) : field.kind === 'date' ? (
          <OrgDateField
            label={label(field)}
            value={values[field.key] ?? ''}
            onChangeText={setValue(field.key)}
            placeholder={String(t(IssueI18nKeys.DATE_PLACEHOLDER))}
            cancelLabel={String(t(IssueI18nKeys.DATE_CANCEL))}
            confirmLabel={String(t(IssueI18nKeys.DATE_CONFIRM))}
            clearLabel={String(t(IssueI18nKeys.DATE_CLEAR))}
            locale={locale}
            {...highlight(field.key)}
          />
        ) : (
          <OrgField
            label={label(field)}
            value={values[field.key] ?? ''}
            placeholder={fieldHint}
            onChangeText={(value) => setValue(field.key)(field.kind === 'integer' ? value.replace(/\D/g, '') : value)}
            autoCapitalize={field.kind === 'text' ? 'sentences' : 'none'}
            keyboardType={field.kind === 'integer' ? 'number-pad' : 'default'}
            multiline={field.kind === 'text' && field.default.length > 40}
            {...highlight(field.key)}
          />
        )}
      </View>
    )
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <StatusBar backgroundColor="transparent" barStyle="light-content" />

      {!signedIn && !offer && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t(IssueI18nKeys.SIGN_IN_TITLE)}</Text>
          <Text style={styles.body}>{t(IssueI18nKeys.SIGN_IN_TEXT, { username: organization.username })}</Text>
          {/* Signing in stays possible: it is how an extension is learnt. */}
          {ended && (
            <Text style={styles.notice}>{t(IssueI18nKeys.ACCREDITATION_EXPIRED_TEXT, { date: endedDate })}</Text>
          )}
          <OrgField
            label={String(t(IssueI18nKeys.PASSWORD))}
            value={password}
            placeholder={String(t(IssueI18nKeys.PASSWORD_PLACEHOLDER))}
            onChangeText={setPassword}
            secure
          />
          {problemText !== '' && <Text style={styles.error}>{problemText}</Text>}
          <OrgButton onPress={signInNow} loading={busy} disabled={busy || !password} style={styles.submit}>
            {t(IssueI18nKeys.SIGN_IN)}
          </OrgButton>
        </View>
      )}

      {signedIn && !offer && ended && (
        <>
          <Text style={styles.organization}>{organization.organization}</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t(IssueI18nKeys.ACCREDITATION_EXPIRED_TITLE)}</Text>
            <Text style={styles.body}>{t(IssueI18nKeys.ACCREDITATION_EXPIRED_TEXT, { date: endedDate })}</Text>
          </View>
        </>
      )}

      {signedIn && !offer && !ended && (
        <>
          <Text style={styles.organization}>{organization.organization}</Text>
          {accreditation.kind === 'valid' && (
            <Text style={styles.hint}>
              {t(IssueI18nKeys.ACCREDITED_UNTIL, { date: localDate(accreditation.until) })}
            </Text>
          )}
          {accreditation.kind === 'ending' && (
            <Text style={styles.notice}>
              {t(IssueI18nKeys.ACCREDITATION_ENDING, {
                date: localDate(accreditation.until),
                days: accreditation.days,
              })}
            </Text>
          )}
          <Text style={styles.body}>{t(IssueI18nKeys.INTRO)}</Text>
          {available && available.schemas.length === 0 && (
            <Text style={styles.notice}>{t(IssueI18nKeys.NO_SCHEMAS)}</Text>
          )}
          {available && available.schemas.length > 1 && (
            <>
              <Text style={styles.section}>{t(IssueI18nKeys.KIND)}</Text>
              <View style={styles.kinds}>
                {available.schemas.map((schema: Schema) => {
                  const selected = schema.credential_type === scheme?.credential_type
                  return (
                    <Chip
                      key={schema.credential_type}
                      accessibilityState={{ selected }}
                      onPress={() => choose(schema)}
                      style={[styles.kind, selected && styles.kindSelected]}
                      textStyle={[styles.kindText, selected && styles.kindTextSelected]}
                    >
                      {schemaName(schema)}
                    </Chip>
                  )
                })}
              </View>
            </>
          )}
          <OrgField
            label={String(t(IssueI18nKeys.HOLDER_REFERENCE))}
            value={holderReference}
            placeholder={String(t(IssueI18nKeys.HOLDER_REFERENCE_PLACEHOLDER))}
            onChangeText={changeHolderReference}
            {...highlight('holderReference')}
          />
          <Text style={styles.hint}>{t(IssueI18nKeys.HOLDER_REFERENCE_HINT)}</Text>
          {scheme
            ? ISSUE_SECTIONS.filter((section) =>
                scheme.fields.some((field: SchemeField) => field.section === section),
              ).map((section) => (
                <View key={section}>
                  <Text style={styles.section}>{t(`SECTION_${section}`)}</Text>
                  {scheme.fields.filter((field: SchemeField) => field.section === section).map(renderField)}
                </View>
              ))
            : problemText === '' && !available && <Text style={styles.hintCentered}>…</Text>}
          {problemText !== '' && <Text style={styles.error}>{problemText}</Text>}
          <OrgButton onPress={issueNow} loading={busy} disabled={busy || !scheme} style={styles.submit}>
            {t(IssueI18nKeys.ISSUE)}
          </OrgButton>
        </>
      )}

      {offer && (
        <>
          <Text style={styles.cardTitle}>{t(IssueI18nKeys.READY_TITLE)}</Text>
          <Text style={styles.body}>{t(IssueI18nKeys.READY_TEXT)}</Text>
          {/* White whatever the theme: a scanner needs the contrast. */}
          <View style={[styles.qrCard, { width: qrSide, height: qrSide }]}>
            <Image
              source={{ uri: offer.qr }}
              style={styles.qr}
              resizeMode="contain"
              accessibilityLabel={String(t(IssueI18nKeys.QR_LABEL))}
            />
          </View>
          {offer.pin && (
            <View style={styles.pinBox}>
              <Text style={styles.pinLabel}>{t(IssueI18nKeys.PIN)}</Text>
              <Text style={styles.pin} selectable>
                {offer.pin.replace(/^(\d{3})(\d+)$/, '$1 $2')}
              </Text>
            </View>
          )}
          <Text style={styles.hintCentered}>
            {t(IssueI18nKeys.VALID_UNTIL, { time: moment(offer.expiresAt).format('HH:mm') })}
          </Text>
          <Button
            mode="text"
            icon="share-variant"
            textColor={orgPrimaryColor}
            onPress={shareOffer}
            style={styles.share}
          >
            {t(IssueI18nKeys.SHARE)}
          </Button>
          <OrgButton onPress={another} style={styles.submit}>
            {t(IssueI18nKeys.ANOTHER)}
          </OrgButton>
        </>
      )}
    </ScrollView>
  )
}

export default IssueScreenView
