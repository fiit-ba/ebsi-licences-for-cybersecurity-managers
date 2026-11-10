// Removes the obsolete feature-toggle provider and accepts React 19 node children.
import type { ReactNode } from 'react'
import FeatureUtils from '@shared/hooks/useFeatureToogle'
interface Props {
  children: ReactNode
}
const FeatureToggleProvider = ({ children }: Props) => {
  const FeatureUtilsInstance = new FeatureUtils()
  // Preserves feature initialization while returning children without the removed dependency.
  FeatureUtilsInstance.useFeature()
  return children
}
export default FeatureToggleProvider
