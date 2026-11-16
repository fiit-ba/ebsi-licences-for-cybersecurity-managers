import React from 'react'
import { View } from 'react-native'
import { DropDownItemArrowConfigType } from '@shared/components/DropDownSelect/type'
import DropDownItemListArrowStyled from '@shared/components/DropDownSelect/components/DropDownItemListArrow/styled'

const DropDownItemListArrow = (props: DropDownItemArrowConfigType) => {
  const position = props.position
  let xPosition = `2%`
  if (position === 'center') {
    xPosition = `50%`
  } else if (position === 'right') {
    xPosition = `85%`
  }
  return (
    <>
      <DropDownItemListArrowStyled.Arrow
        xPosition={xPosition}
        style={{
          ...props.style,
        }}
      />
      <DropDownItemListArrowStyled.ArrowBorderEraser xPosition={xPosition} />
    </>
  )
}

export default DropDownItemListArrow
