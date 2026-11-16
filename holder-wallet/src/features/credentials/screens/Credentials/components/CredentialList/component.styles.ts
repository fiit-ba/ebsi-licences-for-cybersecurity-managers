import { StyleSheet } from 'react-native'
import styled from 'styled-components/native'
import { View } from '@shared/components/Themed'

export const componentStyles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingTop: 2, paddingBottom: 16 },
})

export const LoadingView = styled(View)`
  padding-vertical: 20px;
`
