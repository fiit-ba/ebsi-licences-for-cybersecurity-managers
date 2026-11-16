import { useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Button, TextInput } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FONT_FAMILY } from '@shared/constants/fontFamily'
import { CONTROL_RADIUS, INPUT_HEIGHT } from '@shared/constants/ui'

interface Props {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder: string
  cancelLabel: string
  confirmLabel: string
  clearLabel: string
  locale: 'sk' | 'en'
  disabled?: boolean
  error?: boolean
  outlineColor?: string
  style?: StyleProp<ViewStyle>
}

const parseIsoDate = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null
}

const toIsoDate = (date: Date): string =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

const displayDate = (value: string, locale: Props['locale']): string => {
  const date = parseIsoDate(value)
  if (!date) return ''
  const day = date.getDate()
  const month = date.getMonth() + 1
  return locale === 'sk' ? `${day}. ${month}. ${date.getFullYear()}` : `${day}/${month}/${date.getFullYear()}`
}

/** Native calendar input with the organisation form's visual language. */
const OrgDateField = ({
  label,
  value,
  onChangeText,
  placeholder,
  cancelLabel,
  confirmLabel,
  clearLabel,
  locale,
  disabled,
  error,
  outlineColor,
  style,
}: Props) => {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [visible, setVisible] = useState(false)
  const [draft, setDraft] = useState(parseIsoDate(value) ?? new Date())

  const open = () => {
    setDraft(parseIsoDate(value) ?? new Date())
    setVisible(true)
  }

  const close = () => setVisible(false)

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      close()
      if (event.type === 'neutralButtonPressed') onChangeText('')
      else if (event.type === 'set' && selected) onChangeText(toIsoDate(selected))
      return
    }
    if (selected) setDraft(selected)
  }

  const clear = () => {
    onChangeText('')
    close()
  }

  const confirm = () => {
    onChangeText(toIsoDate(draft))
    close()
  }

  return (
    <>
      <Pressable
        onPress={open}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
      >
        <View pointerEvents="none">
          <TextInput
            mode="outlined"
            label={label}
            value={displayDate(value, locale)}
            placeholder={placeholder}
            editable={false}
            disabled={disabled}
            error={error}
            outlineColor={outlineColor ?? getThemeColor(ColorKeys.border)}
            activeOutlineColor={getThemeColor(ColorKeys.orgPrimary)}
            textColor={getThemeColor(ColorKeys.text)}
            theme={{ roundness: CONTROL_RADIUS }}
            outlineStyle={styles.fieldOutline}
            contentStyle={styles.content}
            style={[styles.field, style]}
            right={<TextInput.Icon icon="calendar-month-outline" forceTextInputFocus={false} />}
          />
        </View>
      </Pressable>

      {visible && Platform.OS === 'android' && (
        <DateTimePicker
          value={draft}
          mode="date"
          display="calendar"
          onChange={onNativeChange}
          positiveButton={{ label: confirmLabel, textColor: getThemeColor(ColorKeys.orgPrimary) }}
          negativeButton={{ label: cancelLabel, textColor: getThemeColor(ColorKeys.mutedText) }}
          neutralButton={value !== '' ? { label: clearLabel, textColor: getThemeColor(ColorKeys.error) } : undefined}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
          <Pressable style={styles.backdrop} onPress={close}>
            <Pressable
              style={[
                styles.sheet,
                { maxHeight: height - insets.top - 12, paddingBottom: Math.max(insets.bottom, 16) },
              ]}
              onPress={(event) => event.stopPropagation()}
            >
              <Text style={styles.title}>{label}</Text>
              <DateTimePicker
                value={draft}
                mode="date"
                display={height < 600 ? 'spinner' : 'inline'}
                locale={locale === 'sk' ? 'sk-SK' : 'en-GB'}
                accentColor={getThemeColor(ColorKeys.orgPrimary)}
                onChange={onNativeChange}
                style={styles.picker}
              />
              <View style={styles.actions}>
                {value !== '' && (
                  <Button textColor={getThemeColor(ColorKeys.error)} onPress={clear}>
                    {clearLabel}
                  </Button>
                )}
                <View style={styles.actionsEnd}>
                  <Button textColor={getThemeColor(ColorKeys.mutedText)} onPress={close}>
                    {cancelLabel}
                  </Button>
                  <Button
                    mode="contained"
                    buttonColor={getThemeColor(ColorKeys.orgPrimary)}
                    textColor="#ffffff"
                    onPress={confirm}
                  >
                    {confirmLabel}
                  </Button>
                </View>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  field: { minHeight: INPUT_HEIGHT, marginTop: 10, backgroundColor: getThemeColor(ColorKeys.background) },
  fieldOutline: { borderRadius: CONTROL_RADIUS },
  content: { minHeight: INPUT_HEIGHT, fontFamily: FONT_FAMILY.PRINCIPAL },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5, 16, 34, 0.48)' },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 18,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: getThemeColor(ColorKeys.background),
  },
  title: {
    fontFamily: FONT_FAMILY.PRINCIPAL,
    fontWeight: '600',
    fontSize: 18,
    color: getThemeColor(ColorKeys.text),
  },
  picker: { alignSelf: 'center', width: '100%' },
  actions: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  actionsEnd: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
})

export default OrgDateField
