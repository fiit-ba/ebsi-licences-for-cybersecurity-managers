// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import { Platform } from 'react-native'
import RequestPreauthorizeUserPinModalStyled from '@features/credentials/components/RequestPreauthorizeUserPinModal/component.styles'
import Header from '@shared/components/Header'
import InputStyled from '@shared/components/atomic_components/InputStyled'
import { RequestPreauthorizeUserPinModalViewProps } from './component.types'

const RequestPreauthorizeUserPinModalView = ({
  data,
  isPinFocused,
  isKeyboardVisible,
  title,
  description,
  pinLabel,
  requestLabel,
  close,
  focus,
  blur,
  changePin,
  accept,
}: RequestPreauthorizeUserPinModalViewProps) => {
  return (
    <RequestPreauthorizeUserPinModalStyled.ModalContainer>
      <Header title={title} onCancel={close} />
      <RequestPreauthorizeUserPinModalStyled.ModalContent>
        <RequestPreauthorizeUserPinModalStyled.ModalText>{description}</RequestPreauthorizeUserPinModalStyled.ModalText>
        <RequestPreauthorizeUserPinModalStyled.DropDownPickerContainer>
          {/*
                A custom floating label preserves the familiar field pattern,
                but its rounded background avoids Paper's sharp rectangular
                notch through the outline. */}
          <RequestPreauthorizeUserPinModalStyled.InputFrame>
            <InputStyled
              accessibilityLabel={pinLabel}
              value={data}
              keyboardType="decimal-pad"
              secureTextEntry
              textContentType="oneTimeCode"
              autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
              onFocus={focus}
              onBlur={blur}
              onChangeText={changePin}
              onSubmitEditing={() => data && accept()}
              returnKeyType={'done'}
              submitBehavior="blurAndSubmit"
            />
            <RequestPreauthorizeUserPinModalStyled.InputLabel $focused={isPinFocused}>
              {pinLabel}
            </RequestPreauthorizeUserPinModalStyled.InputLabel>
          </RequestPreauthorizeUserPinModalStyled.InputFrame>
        </RequestPreauthorizeUserPinModalStyled.DropDownPickerContainer>
      </RequestPreauthorizeUserPinModalStyled.ModalContent>
      <RequestPreauthorizeUserPinModalStyled.ButtonContainer
        style={{
          paddingBottom: isKeyboardVisible ? (Platform.OS === 'ios' ? 72 : 28) : 16,
        }}
      >
        <RequestPreauthorizeUserPinModalStyled.Button disabled={!data} onPress={accept}>
          {requestLabel}
        </RequestPreauthorizeUserPinModalStyled.Button>
      </RequestPreauthorizeUserPinModalStyled.ButtonContainer>
    </RequestPreauthorizeUserPinModalStyled.ModalContainer>
  )
}

export default RequestPreauthorizeUserPinModalView
