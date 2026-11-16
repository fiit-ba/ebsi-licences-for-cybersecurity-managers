import styled from 'styled-components/native'
// Uses maintained safe-area and Expo Camera components after the SDK migration.
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView } from 'expo-camera'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'

const defaultStyles = {
  // Styles CameraView and the maintained safe-area component in place of removed APIs.
  QrScanner: styled(CameraView)`
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
	`,
  Container: styled(SafeAreaView)`
		background-color: black;
		flex: 1;
	`,
  RequestingText: safeStyledText(DescriptionText)`
    color: white;
    margin-top: 50px;
    align-self: center;
  `,
}

export default defaultStyles
