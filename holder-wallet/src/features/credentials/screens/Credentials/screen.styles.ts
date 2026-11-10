import styled from 'styled-components/native'
import { View } from '@shared/components/Themed'

const defaultStyles = {
  ContentView: styled(View)`
    flex: 1;
  `,
  // Filled actions share a compact, background-free group. On narrow phones
  // they stack, so translations never collide or leave the viewport.
  ActionsContainer: styled(View)<{ $stacked: boolean }>`
    flex-shrink: 0;
    flex-direction: ${({ $stacked }) => ($stacked ? 'column' : 'row')};
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    background-color: transparent;
  `,
}

export default defaultStyles
