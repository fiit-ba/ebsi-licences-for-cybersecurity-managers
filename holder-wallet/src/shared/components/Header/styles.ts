import styled from 'styled-components/native'
import { Title } from '@shared/components/atomic_components/Text/variants'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import { safeStyledText } from '@shared/components/atomic_components/Text'

const HeaderStyled = {
  // Header/index.tsx extends this background through ModalScreen's measured
  // top inset; the content itself stays aligned here.
  Header: styled.View`
    background-color: ${getThemeColor(ColorKeys.headerBackground)};
    padding: 18px;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  `,
  Title: safeStyledText(Title)`
		flex: 1;
		margin-right: 12px;
		color: white;
	`,
  CancelButton: safeStyledText(Title)`
		color: white;
		margin-right: 10px;
	`,
}
export default HeaderStyled
