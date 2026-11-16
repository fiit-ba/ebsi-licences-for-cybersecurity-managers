import { useState } from 'react'
import { SeedButtonProps, SeedButtonViewProps } from './component.types'

const useSeedButton = ({ text, onPress }: SeedButtonProps): SeedButtonViewProps => {
  const [visible, setVisible] = useState(true)
  return {
    text,
    visible,
    select: () => {
      onPress()
      setVisible(false)
    },
  }
}
export default useSeedButton
