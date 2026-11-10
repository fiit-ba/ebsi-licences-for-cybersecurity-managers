// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { stageLabel } from '../governanceFormat.ts';
import CodeText from '../../../shared/ui/CodeText.tsx';
import Notice from '../../../shared/ui/Notice.tsx';

/**
 * A wallet vote's progress, then its outcome - the same for proposals and rule changes.
 * @param options - Existing component inputs: {stage, outcome, prefix = ''}.
 * @returns The rendered React content.
 */
export default function Progress(options) {
  const { stage, outcome, prefix = '' } = options;

  return (
    <>
      {stage && (
        <Notice tone="info">
          {stage.id ? `${prefix}${stage.id}: ` : ''}
          {stageLabel(stage.name)}
          {stage.hash && (
            <CodeText className="mt-1" wrap>
              tx {stage.hash}
            </CodeText>
          )}
        </Notice>
      )}
      {outcome && (
        <Notice tone={outcome.ok ? 'ok' : 'err'}>
          {outcome.id ? `${prefix}${outcome.id}: ` : ''}
          {outcome.text}
          {outcome.tx && (
            <CodeText className="mt-1" wrap>
              tx {outcome.tx}
            </CodeText>
          )}
        </Notice>
      )}
    </>
  );
}
