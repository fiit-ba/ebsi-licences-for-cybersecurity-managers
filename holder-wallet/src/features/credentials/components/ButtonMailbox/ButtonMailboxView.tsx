// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import Loading from '@shared/components/Loading'
import {
  ButtonContainer,
  LoadingContainer,
  RefreshButton,
} from '@features/credentials/components/ButtonMailbox/component.styles'
import { ButtonMailboxViewProps } from './component.types'

const ButtonMailboxView = ({ actionWidth, isLoading, label, refresh }: ButtonMailboxViewProps) => {
  return (
    <ButtonContainer>
      {!isLoading ? (
        // Refresh is an actual primary action with a full touch target, not a
        // link that can be difficult to discover or tap.
        <RefreshButton $width={actionWidth} mode="contained" uppercase={false} onPress={refresh}>
          {label}
        </RefreshButton>
      ) : (
        <LoadingContainer $width={actionWidth}>
          <Loading />
        </LoadingContainer>
      )}
    </ButtonContainer>
  )
}

export default ButtonMailboxView
