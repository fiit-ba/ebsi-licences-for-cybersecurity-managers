import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
// Uses React 19's exported element type instead of the removed global JSX namespace.
import { useContext, type ReactElement, type ReactNode } from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import { MessageContext } from '@app/context/UserMessage.context'
import { useTranslation } from 'react-i18next'
// Its strings as a bundle, in Slovak and English, instead of the Spanish text.
import i18next from 'i18next'
import localeSK from '@shared/components/PressToCopy/i18n/sk'
import localeEN from '@shared/components/PressToCopy/i18n/en'

i18next.addResourceBundle('sk', 'PressToCopy', localeSK)
i18next.addResourceBundle('en', 'PressToCopy', localeEN)

interface PressToCopyProps {
  value: string
  onPress?: () => void
  children: ReactNode
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  testID?: string
}

const PressToCopy = ({
  value,
  onPress,
  children,
  style,
  accessibilityLabel,
  testID,
}: PressToCopyProps): ReactElement => {
  // The component's own bundle.
  const { t } = useTranslation('PressToCopy')

  const { showMessage } = useContext(MessageContext)

  const copyToClipboard = (data: string) => {
    // Write directly without reading the existing clipboard. Reading during
    // mount triggers iOS's cross-app paste permission dialog.
    Clipboard.setString(data)
    // A key; the Spanish text used to be passed to t() as its own key.
    const content = t('COPIED_TEXT')
    showMessage?.({ content, type: 'success' })
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || value}
      accessibilityHint={t('COPY_HINT')}
      accessibilityActions={[{ name: 'activate', label: t('COPY_ACTION') }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'activate') copyToClipboard(value)
      }}
      delayLongPress={450}
      style={({ pressed }) => [style, { opacity: pressed ? 0.62 : 1 }]}
      onPress={onPress}
      onLongPress={() => copyToClipboard(value)}
    >
      {children}
    </Pressable>
  )
}

export default PressToCopy
