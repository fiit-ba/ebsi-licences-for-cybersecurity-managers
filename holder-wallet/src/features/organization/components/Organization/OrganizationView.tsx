// The organization's field and button (design decisions D15): the wallet's own,
// in the organization's violet, so its screens read as a different place from
// the holder's blue ones.
import { Text, View } from 'react-native'
import { Button, Icon, TextInput } from 'react-native-paper'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { CONTROL_RADIUS } from '@shared/constants/ui'
import PressToCopy from '@shared/components/PressToCopy'
import { styles } from '@features/organization/components/Organization/component.styles'
export { default as OrgDateField } from '@features/organization/components/Organization/OrgDateField'
import { OrganizationViewProps } from './component.types'

export const OrgFieldView = ({ secure, style, hidden, toggleHidden, ...props }: OrganizationViewProps) => {
  return (
    <TextInput
      mode="outlined"
      autoCapitalize="none"
      autoCorrect={false}
      outlineColor={getThemeColor(ColorKeys.border)}
      activeOutlineColor={getThemeColor(ColorKeys.orgPrimary)}
      textColor={getThemeColor(ColorKeys.text)}
      theme={{ roundness: CONTROL_RADIUS }}
      outlineStyle={styles.fieldOutline}
      contentStyle={styles.content}
      style={[styles.field, style]}
      secureTextEntry={secure && hidden}
      right={
        secure ? (
          <TextInput.Icon icon={hidden ? 'eye-off' : 'eye'} onPress={toggleHidden} forceTextInputFocus={false} />
        ) : undefined
      }
      {...props}
    />
  )
}

type ReadOnlyFieldProps = {
  label: string
  value: string
  error?: boolean
  outlineColor?: string
}

/**
 * A registry-controlled value which looks like the rest of the form but is not
 * an editable input. Both its label and value wrap, so registry-controlled
 * organization names remain fully readable; long press still copies the value.
 */
export const OrgReadOnlyField = ({ label, value, error = false, outlineColor }: ReadOnlyFieldProps) => (
  <PressToCopy value={value} accessibilityLabel={`${label}: ${value}`} style={styles.readOnlyPressable}>
    <View
      style={[
        styles.readOnlyField,
        error && {
          borderColor: outlineColor ?? getThemeColor(ColorKeys.error),
          borderWidth: 2,
        },
      ]}
    >
      <View style={styles.readOnlyText}>
        {/*
            No line limit: the field grows with a long issuer name instead of
            hiding the legally relevant certificate value behind an ellipsis. */}
        <Text style={styles.readOnlyLabel}>{label}</Text>
        <Text style={styles.readOnlyValue}>{value}</Text>
      </View>
      <View style={styles.copyIcon} pointerEvents="none">
        <Icon source="content-copy" size={19} color={getThemeColor(ColorKeys.orgPrimary)} />
      </View>
    </View>
  </PressToCopy>
)

type ButtonProps = React.ComponentProps<typeof Button>

export const OrgButton = ({ style, contentStyle, labelStyle, ...props }: ButtonProps) => (
  <Button
    mode="contained"
    buttonColor={getThemeColor(ColorKeys.orgPrimary)}
    textColor="#ffffff"
    style={[styles.button, style]}
    contentStyle={[styles.buttonContent, contentStyle]}
    labelStyle={[styles.label, labelStyle]}
    {...props}
  />
)
