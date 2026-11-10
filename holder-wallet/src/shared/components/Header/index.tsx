import React from 'react'
// The modal header extends through the native safe area on both platforms.
import { StatusBar, TouchableOpacity } from 'react-native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import HeaderStyled from '@shared/components/Header/styles'
import { IconButton } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface Props {
  title: string
  onCancel: () => void
}
const Header = (props: Props) => {
  const insets = useSafeAreaInsets()

  return (
    <>
      {/*
          Paints the status area with the same navy and keeps its icons readable. */}
      <StatusBar backgroundColor={getThemeColor(ColorKeys.headerBackground)} barStyle="light-content" />
      <HeaderStyled.Header style={{ marginTop: -insets.top, paddingTop: insets.top + 18 }}>
        <HeaderStyled.Title>{props.title}</HeaderStyled.Title>
        <TouchableOpacity onPress={props.onCancel}>
          <IconButton icon={'close'} iconColor={getThemeColor(ColorKeys.invertedText)} style={{ marginVertical: 0 }} />
        </TouchableOpacity>
      </HeaderStyled.Header>
    </>
  )
}

export default Header
