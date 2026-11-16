// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import RequestCredentialModalStyled from '@features/credentials/components/RequestCredentialModal/component.styles'
import Header from '@shared/components/Header'
import DropDownPicker from '@shared/components/DropDownPicker'
import { RequestCredentialModalViewProps } from './component.types'

const RequestCredentialModalView = ({
  title,
  description,
  credentialRequestDescription,
  credentialParams,
  dropdownItems,
  dropdownPlaceholder,
  buttonText,
  close,
  setData,
  accept,
}: RequestCredentialModalViewProps) => {
  return (
    <RequestCredentialModalStyled.ModalContainer>
      <Header title={title} onCancel={close} />
      <RequestCredentialModalStyled.ModalContent>
        <RequestCredentialModalStyled.ModalText>{description}</RequestCredentialModalStyled.ModalText>
        <RequestCredentialModalStyled.CredentialContainer>
          {Object.entries(credentialParams).map(([key, value]) => (
            <RequestCredentialModalStyled.ModalTextContent key={`ModalTextContent-${key}`}>
              <RequestCredentialModalStyled.ModalBoldText>{key}</RequestCredentialModalStyled.ModalBoldText>
              <RequestCredentialModalStyled.ModalValueText numberOfLines={1} ellipsizeMode="tail">
                {value}
              </RequestCredentialModalStyled.ModalValueText>
            </RequestCredentialModalStyled.ModalTextContent>
          ))}
        </RequestCredentialModalStyled.CredentialContainer>
        <RequestCredentialModalStyled.ModalText>{credentialRequestDescription}</RequestCredentialModalStyled.ModalText>
        <RequestCredentialModalStyled.DropDownPickerContainer>
          {/*
                Adds a translated placeholder. */}
          <DropDownPicker onChange={setData} items={dropdownItems} placeholder={dropdownPlaceholder} />
        </RequestCredentialModalStyled.DropDownPickerContainer>
      </RequestCredentialModalStyled.ModalContent>
      <RequestCredentialModalStyled.ButtonContainer>
        <RequestCredentialModalStyled.Button onPress={accept}>{buttonText}</RequestCredentialModalStyled.Button>
      </RequestCredentialModalStyled.ButtonContainer>
    </RequestCredentialModalStyled.ModalContainer>
  )
}

export default RequestCredentialModalView
