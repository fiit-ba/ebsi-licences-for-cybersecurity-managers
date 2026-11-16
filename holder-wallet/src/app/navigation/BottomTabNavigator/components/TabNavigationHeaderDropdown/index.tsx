// Slovak bundle registered next to Spanish (project documentation, Slovak localization).
import { Fragment, useEffect, useState } from 'react'
import { SCREEN } from '@shared/constants/screens'
import i18next from '@app/localization/i18n'
// Removes the Spanish strings: the wallet offers Slovak and English.
import BottonTabNavigationHeaderI18nKeys from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown/i18n/keys'
import { useTranslation } from 'react-i18next'
// Replaces the oversized empty-label button with a compact icon-only menu control.
import { AppState, Pressable, useWindowDimensions } from 'react-native'
import { Divider, Menu } from 'react-native-paper'
import { CommonActions, useIsFocused, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { DropdownView, styles } from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown/style'
import { ColorKeys, getThemeColor } from '@shared/constants/Colors'
import TermsModal from '@shared/components/TermsModal'
// Removes the Spanish strings: the wallet offers Slovak and English.
import useModal from '@shared/hooks/useModal'
import ConfirmationDialog from '@shared/components/ConfirmationDialog'
// Deletes the holder's wallet alone, not the whole of the app's storage (D18).
import { deleteHolderWallet } from '@infrastructure/persistence/keychain'
// Imports the Slovak strings and the English ones (project documentation,
// Localization).
import localeSK from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown/i18n/sk'
import localeEN from '@app/navigation/BottomTabNavigator/components/TabNavigationHeaderDropdown/i18n/en'
// The language switch.
import { otherLanguage, setLanguage } from '@app/localization/Language'
// Switching between the certificate holder's wallet and the organization's
// profile, and deleting either alone (design decisions D15, D18).
import {
  ProfileKind,
  currentOrganization,
  deleteOrganizationProfile,
  openProfile,
} from '@infrastructure/organization/OrganizationService'
import type { RootStackParamList } from '@app/navigation/types'
import type { HeaderMenuItem, HeaderMenuRoute, MenuIcon } from './headerMenu.types'
import { OverflowGlyph } from './OverflowGlyph'

const bundle = 'TabNavigatorHeaderDropDown'

const TabNavigatorHeaderDropDown = () => {
  // Registers the Slovak strings and the English ones, for the language
  // switch; Spanish is no longer offered.
  i18next.addResourceBundle('sk', bundle, localeSK)
  i18next.addResourceBundle('en', bundle, localeEN)
  const { t } = useTranslation(bundle)
  const window = useWindowDimensions()

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [visible, setVisible] = useState<boolean>(false)
  const { showModal } = useModal()
  const [isDialogVisible, setDialogVisible] = useState(false)

  const closeMenu = () => setVisible(false)
  // The menu belongs to the open wallet. When it locks - the app goes to the
  // background and LockAppWrapper puts the sign-in screen over the tabs - the
  // menu and the delete confirmation close, so neither the DIDs nor deleting the
  // wallet is reachable from the sign-in screen without the PIN.
  const focused = useIsFocused()
  useEffect(() => {
    if (focused) return
    setVisible(false)
    setDialogVisible(false)
  }, [focused])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') return
      setVisible(false)
      setDialogVisible(false)
    })
    return () => subscription.remove()
  }, [])
  // Whose wallet this is now, for the switch below.
  const organization = currentOrganization()

  const menuItems: HeaderMenuItem[] = [
    // From the certificate holder's wallet to the organization's profile and
    // back; each keeps what it has.
    {
      title: 'SwitchRole',
      i18nKey: organization
        ? BottonTabNavigationHeaderI18nKeys.SWITCH_TO_HOLDER
        : BottonTabNavigationHeaderI18nKeys.SWITCH_TO_ORG,
      icon: 'account-switch-outline',
    },
    // DIDs are the holder's: the organization's profile has none (D18).
    ...(organization
      ? []
      : [
          {
            title: SCREEN.DidList,
            i18nKey: BottonTabNavigationHeaderI18nKeys.DID_MANAGEMENT,
            icon: 'identifier' as MenuIcon,
          },
        ]),
    {
      title: 'TermsAndConditions',
      i18nKey: BottonTabNavigationHeaderI18nKeys.TERMS_AND_CONDITIONS,
      icon: 'file-document-outline',
      dividerBefore: true,
    },
    {
      title: SCREEN.Login,
      i18nKey: BottonTabNavigationHeaderI18nKeys.BLOCK_SESION,
      icon: 'lock-outline',
    },
    // The language switch, between Slovak and English.
    {
      title: 'Language',
      i18nKey: BottonTabNavigationHeaderI18nKeys.SWITCH_LANGUAGE,
      icon: 'translate',
    },
    {
      title: SCREEN.OnBoarding,
      i18nKey: BottonTabNavigationHeaderI18nKeys.REMOVE_USER_KEYS,
      icon: 'trash-can-outline',
      dividerBefore: true,
      destructive: true,
    },
  ]
  // Opens the other profile at its own sign-in, since its PIN is its own - or,
  // if it does not exist yet, where it is created (D18).
  // The same openProfile the sign-in screen switches with.
  const switchProfile = async (kind: ProfileKind) => {
    if (!(await openProfile(kind))) {
      navigation.navigate(kind === 'holder' ? SCREEN.Register : SCREEN.Organization)
      return
    }
    navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: SCREEN.Login }] }))
  }

  const navigateAndCloseMenu = (screenName: HeaderMenuRoute) => {
    if (screenName === SCREEN.Login || screenName === SCREEN.OnBoarding) {
      const resetAction = CommonActions.reset({
        index: 0,
        routes: [{ name: screenName }],
      })
      navigation.dispatch(resetAction)
    } else {
      navigation.navigate(screenName)
    }
    setVisible(false)
  }

  return (
    <DropdownView>
      <Menu
        visible={visible && focused}
        anchorPosition="bottom"
        elevation={3}
        // Separates the card from the header control. React Native Paper keeps
        // its built-in eight-point screen inset when it resolves the position.
        style={styles.menuPosition}
        contentStyle={[
          styles.menuSurface,
          {
            // Leaves the menu inside React Native Paper's eight-point screen
            // inset even on compact devices.
            width: Math.min(280, window.width - 16),
            backgroundColor: getThemeColor(ColorKeys.titleMenu),
            borderColor: getThemeColor(ColorKeys.border),
          },
        ]}
        onDismiss={closeMenu}
        // React Native Paper's own label is English ("Close menu").
        overlayAccessibilityLabel={t(BottonTabNavigationHeaderI18nKeys.CLOSE_MENU)}
        anchor={
          // A small secondary header action instead of a button that looked as
          // prominent as the screen's primary action.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              visible ? BottonTabNavigationHeaderI18nKeys.CLOSE_MENU : BottonTabNavigationHeaderI18nKeys.OPEN_MENU,
            )}
            accessibilityState={{ expanded: visible }}
            hitSlop={4}
            style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
            onPress={() => setVisible((current) => !current)}
          >
            <OverflowGlyph open={visible} />
          </Pressable>
        }
      >
        {menuItems.map((item) => (
          <Fragment key={item.title}>
            {item.dividerBefore && (
              <Divider style={[styles.divider, { backgroundColor: getThemeColor(ColorKeys.border) }]} />
            )}
            <Menu.Item
              dense
              leadingIcon={item.icon}
              style={styles.menuItem}
              contentStyle={styles.menuItemContent}
              titleStyle={[
                styles.menuItemTitle,
                {
                  color: getThemeColor(item.destructive ? ColorKeys.error : ColorKeys.text),
                },
              ]}
              rippleColor={`${getThemeColor(ColorKeys.primary)}14`}
              onPress={() => {
                if (item.title === 'TermsAndConditions') {
                  showModal?.({
                    Component: TermsModal,
                    modalProps: {
                      // A key, not the Spanish text used as one.
                      buttonText: t(BottonTabNavigationHeaderI18nKeys.BUTTON_CLOSE),
                    },
                  })
                  setVisible(false)
                  // Switches language in place; the screens re-render in it.
                } else if (item.title === 'Language') {
                  setVisible(false)
                  setLanguage(otherLanguage())
                  // The other profile opens with its own PIN (D18). One not
                  // created yet is created: the holder's wallet on the
                  // registration screen, the organization's on its own screen.
                } else if (item.title === 'SwitchRole') {
                  setVisible(false)
                  switchProfile(organization ? 'holder' : 'organization')
                } else if (item.title === SCREEN.OnBoarding) {
                  setVisible(false)
                  setDialogVisible(true)
                } else {
                  navigateAndCloseMenu(item.title)
                }
              }}
              title={t(item.i18nKey)}
            />
          </Fragment>
        ))}
      </Menu>
      {/*
          Deletes the profile shown, and only it (D18): the holder's wallet or
          the organization's profile. The other stays, and the app opens it. */}
      <ConfirmationDialog
        visible={isDialogVisible && focused}
        titleLabel={t(
          organization
            ? BottonTabNavigationHeaderI18nKeys.DIALOG_ORG_TITLE
            : BottonTabNavigationHeaderI18nKeys.DIALOG_TITLE,
        )!}
        message={t(
          organization
            ? BottonTabNavigationHeaderI18nKeys.DIALOG_ORG_DESCRIPTION
            : BottonTabNavigationHeaderI18nKeys.DIALOG_HOLDER_DESCRIPTION,
        )!}
        onPress={async () => {
          setDialogVisible(false)
          if (organization) {
            await deleteOrganizationProfile()
          } else {
            await deleteHolderWallet()
          }
          // The other profile opens if there is one; otherwise, the start.
          const other: ProfileKind = organization ? 'holder' : 'organization'
          navigateAndCloseMenu((await openProfile(other)) ? SCREEN.Login : SCREEN.OnBoarding)
        }}
        onCancel={() => {
          setDialogVisible(false)
        }}
      />
    </DropdownView>
  )
}

export default TabNavigatorHeaderDropDown
