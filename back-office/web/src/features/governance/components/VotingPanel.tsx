// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { t } from '../../../shared/i18n/index.ts';
import Panel from '../../../shared/ui/Panel.tsx';
import SegmentedControl from '../../../shared/ui/SegmentedControl.tsx';
import RoleVoter from './RoleVoter.tsx';
import WalletVoter from './WalletVoter.tsx';

/**
 * Render selection between KMS-backed organizational roles and an external browser wallet.
 * @param options - Existing component inputs: { mode, onMode, roles, role, onRole, wallet, wrongChain, isSigner, label, walletError, onConnect, onSwitch, }.
 * @returns The rendered React content.
 */
export default function VotingPanel(options) {
  const {
    mode,
    onMode,
    roles,
    role,
    onRole,
    wallet,
    wrongChain,
    isSigner,
    label,
    walletError,
    onConnect,
    onSwitch,
  } = options;

  return (
    <Panel
      hint={t(
        'Návrh na chaine otvorí back-office, keď pracovník navrhne zmenu v Životnom cykle — a jeho rola ho zároveň podpíše. Tu sa pridávajú ďalšie podpisy, návrh sa vykonáva alebo vetuje. Externá peňaženka znamená blockchain peňaženku signatára v prehliadači, nie mobilný Atest Wallet držiteľa.',
      )}
      title={t('Hlasovanie')}
    >
      <SegmentedControl
        ariaLabel={t('Spôsob hlasovania')}
        value={mode}
        onChange={onMode}
        options={[
          { value: 'backend', label: t('Rola cez back-office') },
          { value: 'wallet', label: t('Externá peňaženka signatára') },
        ]}
      />

      {mode === 'backend' ? (
        <RoleVoter roles={roles} role={role} onRole={onRole} />
      ) : (
        <WalletVoter
          wallet={wallet}
          wrongChain={wrongChain}
          isSigner={isSigner}
          label={label}
          error={walletError}
          onConnect={onConnect}
          onSwitch={onSwitch}
        />
      )}
    </Panel>
  );
}
