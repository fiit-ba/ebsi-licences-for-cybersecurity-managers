import React, { useState } from 'react'
import { TextInput, TextInputProps } from 'react-native-paper'
import { View } from '@shared/components/Themed'

const SecuredInput = (props: TextInputProps & { secureTextEntry?: boolean }) => {
  const [showPassword, setShowPassword] = useState(true)
  const isPasswordShow = props.secureTextEntry && showPassword
  // Keeps an initially empty controlled password input from throwing.
  const password = (props.value ?? '').replace(/[^ ]/g, '*')
  // The input below preserves a caller-provided trailing adornment when it is
  // not displaying the password visibility control.
  return (
    <View style={{ backgroundColor: 'transparent' }}>
      <TextInput
        {...props}
        value={isPasswordShow && props.multiline ? password : props.value}
        secureTextEntry={isPasswordShow}
        right={
          props.secureTextEntry ? (
            <TextInput.Icon icon={showPassword ? 'eye-off' : 'eye'} onPress={() => setShowPassword(!showPassword)} />
          ) : (
            props.right
          )
        }
      />
    </View>
  )
}

export default SecuredInput
