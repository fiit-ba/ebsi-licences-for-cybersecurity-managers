// Uses React 19's exported types and renders a compact status icon beside the message.
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useContext, type ComponentProps, type ReactElement } from 'react'
import { Text, View } from 'react-native'
import { Snackbar } from 'react-native-paper'
import Colors, { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { FIVE_SECONDS_SNACK_DURATION } from '@shared/constants/Quantities'
import { MessageContext } from '@app/context/UserMessage.context'
import { styles } from '@shared/components/Snackbar/styles'

type MessageIcon = ComponentProps<typeof MaterialCommunityIcons>['name']
// Gives every message type a recognizable but restrained semantic accent.
const getMessageAppearance = (messageType: string): { color: string; icon: MessageIcon } => {
  if (messageType === 'error') {
    return { color: getThemeColor(ColorKeys.error), icon: 'alert-circle-outline' }
  }
  if (messageType === 'warning') {
    return { color: Colors.warning, icon: 'alert-outline' }
  }
  if (messageType === 'success') {
    return { color: getThemeColor(ColorKeys.success), icon: 'check-circle-outline' }
  }
  return { color: getThemeColor(ColorKeys.primary), icon: 'information-outline' }
}

export default function SnackbarMessage(): ReactElement {
  const { setMessageInfo, messageInfo } = useContext(MessageContext)
  const appearance = getMessageAppearance(messageInfo.type)
  const dismiss = () => {
    setMessageInfo({ content: '', type: '', isVisible: false })
  }

  return (
    // Replaces the solid status-colour block with a calm surface, a slim accent
    // and an icon, retaining enough contrast in both colour schemes.
    <Snackbar
      wrapperStyle={styles.wrapper}
      visible={Boolean(messageInfo.isVisible && messageInfo.content)}
      duration={FIVE_SECONDS_SNACK_DURATION}
      onDismiss={dismiss}
      elevation={3}
      contentStyle={styles.content}
      style={[
        styles.snackbar,
        {
          backgroundColor: getThemeColor(ColorKeys.surface),
          borderColor: getThemeColor(ColorKeys.border),
          borderLeftColor: appearance.color,
        },
      ]}
    >
      <View style={styles.messageRow}>
        <View style={[styles.iconBackground, { backgroundColor: `${appearance.color}18` }]}>
          <MaterialCommunityIcons name={appearance.icon} size={20} color={appearance.color} />
        </View>
        <Text style={[styles.message, { color: getThemeColor(ColorKeys.text) }]}>{messageInfo.content}</Text>
      </View>
    </Snackbar>
  )
}
