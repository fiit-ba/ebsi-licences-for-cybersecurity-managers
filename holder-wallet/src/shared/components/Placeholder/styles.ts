import styled from 'styled-components/native'
import { DescriptionText, Title } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'

export const StyledContainerPlaceholder = styled.View`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding-top: 30px;
  padding-horizontal: 27px;
`

export const StyledTitlePlaceholder = safeStyledText(Title)`
		font-size: 24px;
		font-weight: bold;
		font-style: normal;
		margin-bottom: 30px;
`

export const StyledTextPlaceholder = safeStyledText(DescriptionText).attrs({ fontWeight: '600' })`
		/*
			 Left-aligned: justified, the narrow column opened wide gaps between words. */
		text-align: left;
		font-size: 16px;
		letter-spacing: 0.3px;
`
