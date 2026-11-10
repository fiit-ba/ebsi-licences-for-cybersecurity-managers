import React from 'react'
import { View } from '@shared/components/Themed'
import DropDownStyled from '@shared/components/DropDownSelect/component.styles'
import DropDownItem from '@shared/components/DropDownSelect/components/DropDownItem'
import DropDownValue from '@shared/components/DropDownSelect/components/DropDownValue'
import DropDownItemListArrow from '@shared/components/DropDownSelect/components/DropDownItemListArrow'
import { DropDownSelectViewProps } from './component.types'

const DropDownSelectView = ({
  isExpand,
  selectedData,
  theme,
  setIsExpand,
  toggleItem,
  ...props
}: DropDownSelectViewProps) => {
  return (
    <DropDownStyled.DropDownContainer
      style={{
        backgroundColor: props.backgroundColor,
        ...props.containerStyle,
      }}
      testID={props.testID}
    >
      <DropDownValue
        value={props.title}
        isExpand={isExpand}
        setIsExpand={setIsExpand}
        theme={theme}
        configuration={props.configuration}
        titleStyle={props.titleStyle}
        activationColor={props.activationColor}
        dropdownValueContentStyle={props.valueContentStyle}
      />
      {isExpand && (
        <DropDownStyled.RelativeView>
          <View
            style={{
              position: 'absolute',
              width: '100%',
              borderWidth: 1,
              zIndex: 10,
              ...props.itemContainerStyle,
            }}
          >
            {props.data &&
              Object.entries(props.data).map(([key, value], index) => (
                <DropDownItem
                  key={`dropDownItem-${key}-${index}`}
                  onPress={() => toggleItem(key)}
                  text={value}
                  isSelected={selectedData[key]}
                  configuration={props.configuration}
                />
              ))}
          </View>
          {props.withListArrow && (
            <DropDownItemListArrow style={props.itemContainerStyle} position={props.listArrowPosition} />
          )}
        </DropDownStyled.RelativeView>
      )}
    </DropDownStyled.DropDownContainer>
  )
}

export default DropDownSelectView
