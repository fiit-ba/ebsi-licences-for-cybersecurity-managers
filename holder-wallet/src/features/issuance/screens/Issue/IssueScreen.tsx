import IssueScreenView from './IssueScreenView'
import { IssueScreenProps } from './screen.types'
import useIssueScreen from './useIssueScreen'

const IssueScreen = (props: IssueScreenProps) => <IssueScreenView {...useIssueScreen(props)} />

export default IssueScreen
