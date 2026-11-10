// The DID list scrolls rather than clipping on compact screens.
import { ScrollView, View } from 'react-native'
import styled from 'styled-components'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { Subtitle } from '@shared/components/atomic_components/Text/variants'
import { getThemeColor, ColorKeys } from '@shared/constants/Colors'

const defaultStyles = {
  ContainerBottom: styled(View)`
		flex: 1;
		justify-content: flex-end;
		align-items: center;
		margin: 20px auto 40px auto;
		width: 100%;
	`,

  Button: styled(ButtonStyled)``,

  CopyText: safeStyledText(Subtitle)`
  color: ${getThemeColor(ColorKeys.primary)};
  margin-top: 10px;
`,

  MainContainer: styled(ScrollView).attrs({
    contentContainerStyle: { flexGrow: 1 },
    showsVerticalScrollIndicator: false,
  })`
		flex: 1;
	`,
  TextContainer: styled(View)`
		padding: 20px;
		margin-top: 5px;
	`,
}

export default defaultStyles
