// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { t } from '../shared/i18n/index.ts';
import Notice from '../shared/ui/Notice.tsx';
import Sidebar from './Sidebar.tsx';
import SignInNotices from './SignInNotices.tsx';

/**
 * Render the existing sidebar, page heading, sign-in notices and selected workflow.
 * @param options - Existing component inputs: { active, children, contract, notices, onCloseNotices, onContract, onSignOut, page, profile, roles, tabs, }.
 * @returns The rendered React content.
 */
export default function AppShell(options: {
  active?: string;
  children?: import('react').ReactNode;
  contract?: string;
  notices?: unknown;
  onCloseNotices?: () => void;
  onContract?: (value: string) => void;
  onSignOut: () => void;
  page?: { label: string; description: string };
  profile?: { username: string; organization?: string };
  roles: string[];
  tabs: { key: string; path: string; label: string; icon: string }[];
}) {
  const {
    active,
    children,
    contract,
    notices,
    onCloseNotices,
    onContract,
    onSignOut,
    page,
    profile,
    roles,
    tabs,
  } = options;

  return (
    <div className="app">
      <Sidebar
        active={active}
        contract={contract}
        onContract={onContract}
        onSignOut={onSignOut}
        profile={profile}
        tabs={tabs}
      />

      <main className="main">
        {page && (
          <header className="page-head">
            <h1>{page.label}</h1>
            <p>{page.description}</p>
          </header>
        )}

        <SignInNotices notices={notices} onClose={onCloseNotices} />

        {profile && roles.length === 0 && (
          <Notice>
            {t(
              'Nemáte pridelenú žiadnu rolu registra. Pridelí ju správca zaradením do skupiny plr_issuer, plr_status_manager, plr_verifier, plr_auditor, plr_rtao alebo plr_tao.',
            )}
          </Notice>
        )}

        {children}
      </main>
    </div>
  );
}
