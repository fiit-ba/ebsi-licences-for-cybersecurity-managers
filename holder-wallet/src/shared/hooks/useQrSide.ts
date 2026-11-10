import { useWindowDimensions } from 'react-native'

/** The screens' content column: at most this wide, with this padding on each side. */
const CONTENT_MAX_WIDTH = 600
const CONTENT_PADDING = 20

/**
 * The side of a square QR code card, at most `max`, on any screen. Set as the
 * card's width and height: `aspectRatio` with a `maxWidth` gave a card as tall
 * as the screen was wide (Yoga takes the ratio before the limit), so on a
 * tablet the code sat in a white strip twice as tall as it was wide.
 */
export const useQrSide = (max: number): number => {
  const { width } = useWindowDimensions()
  return Math.max(160, Math.min(max, Math.min(width, CONTENT_MAX_WIDTH) - 2 * CONTENT_PADDING))
}
