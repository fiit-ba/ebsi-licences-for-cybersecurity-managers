import DidCard from './components/DidCard'
import PressToCopy from '@shared/components/PressToCopy'
import DerivationPathStyled from '../DerivationPath/screen.styles'
import DidListStyled from './screen.styles'
import { DidListScreenViewProps } from './screen.types'
const DidListScreenView = ({ didList, isCreatingDid, labels, createDid }: DidListScreenViewProps) => {
  const visible = didList.filter(({ did }) => Boolean(did))
  const hasEbsiDid = didList.some(({ entity, did }) => entity === 'ebsi' && Boolean(did))
  return (
    <DidListStyled.MainContainer>
      {visible.length ? (
        <>
          {visible.map(({ did, network, entity }, index) => (
            <PressToCopy value={did} key={index}>
              <DidCard did={did} network={network} entity={entity} />
            </PressToCopy>
          ))}
          <DidListStyled.TextContainer>
            <DerivationPathStyled.CopyText>{labels.copy}</DerivationPathStyled.CopyText>
            <DerivationPathStyled.CopyText>{labels.hint}</DerivationPathStyled.CopyText>
          </DidListStyled.TextContainer>
        </>
      ) : (
        <DidListStyled.TextContainer>
          <DerivationPathStyled.CopyText>{labels.empty}</DerivationPathStyled.CopyText>
        </DidListStyled.TextContainer>
      )}
      {!hasEbsiDid ? (
        <DidListStyled.ContainerBottom>
          <DidListStyled.Button loading={isCreatingDid} disabled={isCreatingDid} onPress={createDid}>
            {labels.add}
          </DidListStyled.Button>
        </DidListStyled.ContainerBottom>
      ) : null}
    </DidListStyled.MainContainer>
  )
}
export default DidListScreenView
