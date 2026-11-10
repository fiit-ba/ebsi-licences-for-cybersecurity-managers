// Uses React 19's exported element type instead of the removed global JSX namespace.
import React, { type ReactElement } from 'react'

import { ButtonText, StyledSeedButton } from '@features/recovery/components/SeedButton/component.styles'

import { SeedButtonViewProps } from './component.types'

export default function SeedButtonView({ text, visible, select }: SeedButtonViewProps): ReactElement {
  return (
    <StyledSeedButton style={!visible && { display: 'none' }} onPress={select}>
      <ButtonText>{text}</ButtonText>
    </StyledSeedButton>
  )
}
