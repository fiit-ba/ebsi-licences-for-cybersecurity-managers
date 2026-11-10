import TextStyled, { safeStyledText } from '@shared/components/atomic_components/Text'
import { FONT_FAMILY } from '@shared/constants/fontFamily'

const Title = safeStyledText(TextStyled).attrs({ bold: true, fontFamily: FONT_FAMILY.SECONDARY })`
  font-size: 24px;
`

export default Title
