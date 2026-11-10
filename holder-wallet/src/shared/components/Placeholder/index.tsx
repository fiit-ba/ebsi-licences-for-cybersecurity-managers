import {
  StyledContainerPlaceholder,
  StyledTitlePlaceholder,
  StyledTextPlaceholder,
} from '@shared/components/Placeholder/styles'

interface Props {
  placeholderTitle?: string
  placeholderText?: string
}

const Placeholder = (props: Props) => {
  const { placeholderTitle, placeholderText } = props

  return (
    <StyledContainerPlaceholder>
      <StyledTitlePlaceholder>{placeholderTitle}</StyledTitlePlaceholder>
      <StyledTextPlaceholder>{placeholderText}</StyledTextPlaceholder>
    </StyledContainerPlaceholder>
  )
}

export default Placeholder
