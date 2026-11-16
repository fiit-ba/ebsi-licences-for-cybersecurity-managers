import styled from 'styled-components'
import TextStyled from '@shared/components/atomic_components/Text'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'

const ErrorText = styled(TextStyled)`
	font-size: 16px;
	line-height: 20px;
	color: ${getThemeColor(ColorKeys.error)};
`

export default ErrorText
