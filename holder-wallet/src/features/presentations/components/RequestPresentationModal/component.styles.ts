import styled from 'styled-components/native'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import ButtonStyled from '@shared/components/atomic_components/Button'
import { DescriptionText } from '@shared/components/atomic_components/Text/variants'
import { safeStyledText } from '@shared/components/atomic_components/Text'
import { CONTROL_HEIGHT, CONTROL_RADIUS } from '@shared/constants/ui'

const RequestPresentationModalStyled = {
  ModalContainer: styled.View`
    justify-content: space-between;
    flex: 1;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  CredentialContainer: styled.View`
    margin-top: 4px;
    margin-bottom: 12px;
    /*
		 * Takes the room left for the list (ScrollContainer below). */
    flex: 1;
  `,
  ModalContent: styled.View`
    padding: 20px;
    background-color: ${getThemeColor(ColorKeys.background)};
    /*
		 * Fills the space between the header and the button instead of a fixed
		 * 550px, which with the modal kept clear of the system bars left the
		 * list a sliver (ScrollContainer below). */
    flex: 1;
  `,
  ButtonContainer: styled.View`
    flex-direction: row;
    justify-content: center;
    padding: 12px 20px 16px 20px;
    background-color: ${getThemeColor(ColorKeys.background)};
  `,
  Button: styled(ButtonStyled).attrs((props) => ({
    contentStyle: {
      height: CONTROL_HEIGHT,
      width: '100%',
      borderRadius: CONTROL_RADIUS,
      backgroundColor: getThemeColor(props.disabled ? ColorKeys.disabled : ColorKeys.primary),
    },
  }))`
    width: 100%;
    max-width: 420px;
  `,
  ModalText: safeStyledText(DescriptionText)`margin-bottom: 20px; margin-top: 0px;`,

  Container: styled.View`
    flex: 1;
    min-width: 0px;
    background-color: transparent;
  `,
  HeaderContainer: styled.View`
    width: 100%;
    background-color: ${getThemeColor(ColorKeys.surface)};
    flex-direction: row;
    align-items: center;
    border-width: 1px;
    border-color: ${getThemeColor(ColorKeys.border)};
    border-radius: 12px;
    margin-bottom: 10px;
  `,
  SelectionSummary: safeStyledText(DescriptionText)`
		align-self: flex-end;
		color: ${getThemeColor(ColorKeys.mutedText)};
		font-size: 12px;
		font-weight: 600;
		margin-bottom: 8px;
	`,
  ScrollContainer: styled.ScrollView`
    /*
		 * As tall as the screen allows. A fixed 340px showed about three
		 * certificates, cut the next mid-line and left the rest of the screen
		 * empty, so a holder with more had to find the scroll in a small box. */
    flex: 1;
  `,
  // A responsive, fully tappable card replaces divider-only rows. It wraps on
  // narrow Android devices and does not depend on an iPhone-specific width.
  ItemContainer: styled.Pressable<{ $selected: boolean; $disabled: boolean }>`
    width: 100%;
    flex-direction: row;
    align-items: flex-start;
    border-width: ${({ $selected }) => ($selected ? 2 : 1)}px;
    border-color: ${({ $selected }) =>
      $selected ? getThemeColor(ColorKeys.primary) : getThemeColor(ColorKeys.border)};
    border-radius: ${CONTROL_RADIUS}px;
    padding: ${({ $selected }) => ($selected ? 13 : 14)}px 14px;
    margin-bottom: 12px;
    background-color: ${({ $selected }) =>
      $selected ? getThemeColor(ColorKeys.scrollBackground) : getThemeColor(ColorKeys.surface)};
    opacity: ${({ $disabled }) => ($disabled ? 0.88 : 1)};
  `,
  ItemControl: styled.View`
    margin-left: -8px;
    margin-right: 6px;
    margin-top: -5px;
    background-color: transparent;
  `,
  // The number goes below the title when both do not fit side by side - a
  // narrow phone, a large font - rather than squeezing the title until its
  // words break apart.
  CardTopRow: styled.View`
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    background-color: transparent;
    margin-bottom: 12px;
  `,
  CardTitle: safeStyledText(DescriptionText)`
		flex: 1;
		min-width: 160px;
		font-size: 15px;
		line-height: 20px;
		font-weight: 700;
		margin-right: 8px;
	`,
  NumberBadge: styled.View`
    background-color: ${getThemeColor(ColorKeys.background)};
    border-radius: 10px;
    padding: 3px 8px;
  `,
  NumberText: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 16px;
		font-weight: 600;
		color: ${getThemeColor(ColorKeys.primary)};
	`,
  DateRow: styled.View`
    flex-direction: row;
    background-color: transparent;
    margin-bottom: 10px;
  `,
  DateColumn: styled.View`
    flex: 1;
    background-color: transparent;
    margin-right: 8px;
  `,
  MetaLabel: safeStyledText(DescriptionText)`
		font-size: 11px;
		line-height: 15px;
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
  MetaValue: safeStyledText(DescriptionText)`
		font-size: 13px;
		line-height: 18px;
		font-weight: 600;
	`,
  IssuerValue: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		color: ${getThemeColor(ColorKeys.mutedText)};
	`,
  StatusNote: safeStyledText(DescriptionText)`
		font-size: 12px;
		line-height: 17px;
		font-weight: 700;
		margin-top: 10px;
		${(props: any) => (props.color ? `color: ${props.color};` : '')}
	`,
}

export default RequestPresentationModalStyled
