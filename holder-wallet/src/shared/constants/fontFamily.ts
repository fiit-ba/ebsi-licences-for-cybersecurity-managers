// One typeface, Inter (SIL Open Font License, assets/fonts/Inter-LICENSE.txt).
// The weight picks the face: Android resolves it from the font family in
// android/app/src/main/res/font/inter.xml (registered in MainApplication), iOS
// from the faces loaded in shared/hooks/useCachedResources.ts. A single-face family
// would be emboldened artificially instead, or on Android not found at all
// for bold and replaced by the system font. The old per-weight names stay as
// aliases so the call sites keep working; give them a fontWeight.
export const FONT_FAMILY = {
  PRINCIPAL: 'Inter',
  PRINCIPAL_600: 'Inter',
  SECONDARY: 'Inter',
}

// Faces loaded for iOS, which finds a family's weights among loaded fonts.
export const FONT_FACES = {
  Inter: require('../../assets/fonts/Inter-Regular.ttf'),
  'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
  'Inter-Bold': require('../../assets/fonts/Inter-Bold.ttf'),
}
