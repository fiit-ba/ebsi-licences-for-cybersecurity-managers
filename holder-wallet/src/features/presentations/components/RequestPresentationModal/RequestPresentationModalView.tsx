import Header from '@shared/components/Header'
import { View } from '@shared/components/Themed'
import CredentialList from './components/CredentialList'
import CredentialsEmptyState from './components/CredentialsEmptyState'
import DisclosureList from './components/DisclosureList'
import RequestPresentationModalStyled from './component.styles'
import type useRequestPresentationModal from './useRequestPresentationModal'

type RequestPresentationModalViewProps = ReturnType<typeof useRequestPresentationModal>

const RequestPresentationModalView = ({
  title,
  description,
  showSelectCredentials,
  showFields,
  disclosable,
  chosen,
  validCredentials,
  checking,
  usableCount,
  listedCredentials,
  availability,
  requiredCount,
  selectionComplete,
  checkingText,
  noneUsableText,
  buttonText,
  close,
  choose,
  setCredentialsSelected,
  processCredentials,
}: RequestPresentationModalViewProps) => (
  <RequestPresentationModalStyled.ModalContainer>
    <Header title={title} onCancel={close} />
    <View style={{ flex: 1 }}>
      <RequestPresentationModalStyled.ModalContent>
        <RequestPresentationModalStyled.ModalText>{description}</RequestPresentationModalStyled.ModalText>
        {showFields && (
          <RequestPresentationModalStyled.CredentialContainer>
            <DisclosureList certificates={disclosable} chosen={chosen} onChoose={choose} />
          </RequestPresentationModalStyled.CredentialContainer>
        )}
        {showSelectCredentials && !showFields && (
          <RequestPresentationModalStyled.CredentialContainer>
            {!validCredentials.length ? (
              <CredentialsEmptyState />
            ) : checking ? (
              <RequestPresentationModalStyled.ModalText>{checkingText}</RequestPresentationModalStyled.ModalText>
            ) : (
              <>
                {usableCount === 0 && (
                  <RequestPresentationModalStyled.ModalText>{noneUsableText}</RequestPresentationModalStyled.ModalText>
                )}
                <CredentialList
                  credentials={listedCredentials}
                  availability={availability}
                  requiredCount={requiredCount}
                  onChangeSelectedCredentials={setCredentialsSelected}
                />
              </>
            )}
          </RequestPresentationModalStyled.CredentialContainer>
        )}
      </RequestPresentationModalStyled.ModalContent>
    </View>
    <RequestPresentationModalStyled.ButtonContainer>
      <RequestPresentationModalStyled.Button
        onPress={processCredentials}
        disabled={showSelectCredentials && (!selectionComplete || checking)}
      >
        {buttonText}
      </RequestPresentationModalStyled.Button>
    </RequestPresentationModalStyled.ButtonContainer>
  </RequestPresentationModalStyled.ModalContainer>
)

export default RequestPresentationModalView
