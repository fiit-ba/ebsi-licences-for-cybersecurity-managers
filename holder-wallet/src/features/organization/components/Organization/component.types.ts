import { TextInputProps } from 'react-native-paper'

export type OrganizationProps = Omit<TextInputProps, 'theme'> & { secure?: boolean }

export interface OrganizationViewProps extends OrganizationProps {
  hidden: boolean
  toggleHidden: () => void
}
