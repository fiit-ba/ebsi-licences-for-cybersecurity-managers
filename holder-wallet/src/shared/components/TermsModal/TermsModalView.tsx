// Imports the sheet's header, version line and list items.
import {
  Bullet,
  BulletRow,
  Container,
  Header,
  ModalText,
  ModalTitle,
  ModalView,
  TextContainer,
  TitleBlock,
  Version,
} from '@shared/components/TermsModal/component.styles'
import ButtonStyled from '@shared/components/atomic_components/Button'
// Uses React 19's exported element type instead of the removed global JSX namespace.
import type { ReactElement } from 'react'
// Removes the Spanish strings: the wallet offers Slovak and English.
import { Text } from 'react-native'
// The operator's own terms, when supplied (operator/terms.ts), and the
// language switch, so the terms can be read in the other language.
import LanguageToggle from '@shared/components/LanguageToggle'
import { TermsModalViewProps } from './component.types'
// The text's paragraphs - split on blank lines, the source's indentation
// dropped - so they are laid out here rather than by stray tabs and
// newlines. A paragraph starting with "·", "•" or "-" is a list item.
const LIST_ITEM = /^[·•-]\s*/
export default function TermsModalView({
  title,
  version,
  paragraphs,
  buttonText,
  onClose,
}: TermsModalViewProps): ReactElement {
  const renderFormattedText = (text: string) => {
    const parts = text.split('**')
    return parts.map((part, index) => {
      if (index % 2 === 0) {
        return <Text key={index}>{part}</Text>
      } else {
        return (
          <Text key={index} style={{ fontWeight: 'bold' }}>
            {part}
          </Text>
        )
      }
    })
  }
  // A title bar with the language switch, the text in paragraphs and list
  // items, and the button in its own bar below it (styles.ts).
  return (
    <ModalView>
      <Header>
        <TitleBlock>
          <ModalTitle>{title}</ModalTitle>
          {/*
              Shows the version of the operator's own terms
              (operator/terms.ts). */}
          {version && <Version>{version}</Version>}
        </TitleBlock>
        <LanguageToggle tone="onBackground" />
      </Header>
      <TextContainer showsVerticalScrollIndicator={true}>
        {/*
            The text as paragraphs and list items (paragraphsOf). */}
        {paragraphs.map((paragraph, index) =>
          LIST_ITEM.test(paragraph) ? (
            <BulletRow key={index}>
              <Bullet>•</Bullet>
              <ModalText style={{ flex: 1, marginBottom: 8 }}>
                {renderFormattedText(paragraph.replace(LIST_ITEM, ''))}
              </ModalText>
            </BulletRow>
          ) : (
            <ModalText key={index}>{renderFormattedText(paragraph)}</ModalText>
          ),
        )}
      </TextContainer>
      {/*
          The button below the scrolling text, in its own bar. */}
      <Container>
        <ButtonStyled mode="contained" uppercase={false} onPress={onClose}>
          {buttonText}
        </ButtonStyled>
      </Container>
    </ModalView>
  )
}
