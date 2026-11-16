import styled from 'styled-components/native'
// Its end clears the system's navigation bar on any phone.
import SafeScrollView from '@shared/components/SafeScrollView'
/** Shared responsive shell for setup flows without a native navigation header. */
const ScreenMarginStyle = styled(SafeScrollView).attrs({
  automaticallyAdjustKeyboardInsets: true,
  bounces: false,
  contentContainerStyle: { flexGrow: 1, paddingHorizontal: 25, paddingBottom: 35 },
  keyboardDismissMode: 'on-drag',
  keyboardShouldPersistTaps: 'handled',
  showsVerticalScrollIndicator: false,
})`
  flex: 1;
  width: 100%;
  max-width: 650px;
  align-self: center;
`

export default ScreenMarginStyle
