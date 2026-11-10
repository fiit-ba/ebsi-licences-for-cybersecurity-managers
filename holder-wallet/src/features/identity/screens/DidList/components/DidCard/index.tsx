import DidCardStyled from '@features/identity/screens/DidList/components/DidCard/styles'
import { useTranslation } from 'react-i18next'
import { SCREEN } from '@shared/constants/screens'
import { capitalizeString } from '@shared/utils/string'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

interface Props {
  did: string
  network: string
  entity: string
}

const DidCard = (props: Props) => {
  const { t } = useTranslation(SCREEN.DidList)
  const directionId = props.did
  return (
    <DidCardStyled.Container>
      <DidCardStyled.ViewRow>
        <MaterialCommunityIcons
          accessibilityElementsHidden
          color={getThemeColor(ColorKeys.primary)}
          importantForAccessibility="no-hide-descendants"
          name="account-key-outline"
          size={20}
        />
        <DidCardStyled.TextContainer>
          <DidCardStyled.Title bold>{capitalizeString(props.entity)} ID</DidCardStyled.Title>
          <DidCardStyled.DescriptionText>{directionId}</DidCardStyled.DescriptionText>
        </DidCardStyled.TextContainer>
      </DidCardStyled.ViewRow>
    </DidCardStyled.Container>
  )
}

export default DidCard
