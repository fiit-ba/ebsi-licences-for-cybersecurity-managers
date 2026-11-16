// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Component } from 'react';
import Button from '../shared/ui/Button.tsx';
import CodeText from '../shared/ui/CodeText.tsx';
import FormActions from '../shared/ui/FormActions.tsx';
import Notice from '../shared/ui/Notice.tsx';
import Panel from '../shared/ui/Panel.tsx';
import { t } from '../shared/i18n/index.ts';

/** Content boundary reset when the selected workflow changes. */
type ErrorBoundaryProps = { children?: import('react').ReactNode; resetKey: string };

/** Contain a rendering failure within the selected workflow while retaining navigation. */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  state = { error: null };

  /**
   * Retain a caught rendering error for the workflow fallback.
   * @param error - Caught failure from the existing backend, browser or contract operation.
   * @returns The boundary state containing the caught error.
   */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /**
   * Clear the rendering failure when navigation changes the boundary reset key.
   * @param previousProps - Previously rendered workflow boundary properties.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  /**
   * Render the workflow content or the existing recoverable error panel.
   * @returns The rendered React content.
   */
  render() {
    const { children } = this.props;
    const { error } = this.state;

    if (!error) return children;

    return (
      <Panel
        title={t('Táto časť sa nepodarila zobraziť.')}
        hint={t(
          'Môžete skúsiť obrazovku obnoviť alebo prejsť na inú sekciu. Navigácia a odhlásenie zostávajú dostupné.',
        )}
      >
        <Notice tone="err">{t('Aplikácia zachytila chybu v tejto časti stránky.')}</Notice>
        <FormActions>
          <Button onClick={this.reset}>{t('Skúsiť znova')}</Button>
        </FormActions>
        {import.meta.env.DEV && (
          <CodeText className="mt-3" wrap>
            {error?.message || String(error)}
          </CodeText>
        )}
      </Panel>
    );
  }
}
