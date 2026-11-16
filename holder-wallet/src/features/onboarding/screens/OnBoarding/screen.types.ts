import { ReactNode } from 'react'
import { RootStackScreenProps } from '@app/navigation/types'
export type OnBoardingScreenProps = RootStackScreenProps<'OnBoarding'>
export type OnBoardingPage = { illustration: any; title: string; subtitle: string }
export type OnBoardingScreenViewProps = {
  pages: OnBoardingPage[]
  activePage: number
  bottomInset: number
  onPageSelected: (position: number) => void
  onContinue: () => void
  header: ReactNode
}
