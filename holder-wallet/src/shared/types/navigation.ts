// Uses React 19 component types and the current navigator option contracts.
import type { ComponentType } from 'react'
import { MaterialTopTabNavigationOptions } from '@react-navigation/material-top-tabs'
import { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs'
import { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import type { RootTabParamList } from '@app/navigation/types'

export type NavigationScreenConfig = {
  name: string
  // Accepts current stack, top-tab and bottom-tab screen components and options.
  component: ComponentType<any>
  options:
    | NativeStackNavigationOptions
    | MaterialTopTabNavigationOptions
    | BottomTabNavigationOptions
    | ((x: any) => NativeStackNavigationOptions | MaterialTopTabNavigationOptions | BottomTabNavigationOptions)
}

export type TabScreenConfig = Omit<NavigationScreenConfig, 'options'> & {
  name: keyof RootTabParamList
  options: MaterialTopTabNavigationOptions
}

/** @deprecated Use NavigationScreenConfig or TabScreenConfig. */
export type navigationScreensConfigType = NavigationScreenConfig
