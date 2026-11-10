// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SESSION_EXPIRED, me, signedIn } from '../shared/api/auth.ts';
import Notice from '../shared/ui/Notice.tsx';
import { t, useI18n } from '../shared/i18n/index.ts';
import AppShell from './AppShell.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import Login from './Login.tsx';
import { APP_ROUTES, resolveAppRoute } from './routing/routes.ts';
import { normalizeRoutePath, routeLocation } from './routing/url.ts';
import { notifications } from '../shared/api/notifications.ts';
import PasswordRecovery from '../features/account/PasswordRecovery.tsx';
import StaffAccounts from '../features/account/StaffAccounts.tsx';
import StaffGroups from '../features/account/StaffGroups.tsx';
import StaffPassword from '../features/account/StaffPassword.tsx';
import AdministrationHome from '../features/account/AdministrationHome.tsx';

/**
 * Select public recovery pages or the existing authenticated operator application.
 * @returns The current route's application screen.
 */
export default function App() {
  const location = useLocation();
  if (['/admin', '/admin/', '/admin/login/'].includes(location.pathname))
    return <AdministrationHome />;
  if (location.pathname === '/admin/password_change/') return <StaffPassword />;
  if (/^\/admin\/auth\/group(?:\/(?:add|[1-9]\d*\/(?:change|delete)))?\/?$/.test(location.pathname))
    return <StaffGroups />;
  if (
    /^\/admin\/auth\/user(?:\/(?:add|[1-9]\d*\/(?:change|delete|password)))?\/?$/.test(
      location.pathname,
    )
  )
    return <StaffAccounts />;
  if (/^\/password_reset(?:\/(?:complete|done))?\/?$/.test(location.pathname)) {
    return <PasswordRecovery key={location.pathname + location.hash} />;
  }
  return <OperatorApplication />;
}

/** Pasted in the status bar, when the back-office names no contract. */
const CONTRACT_KEY = 'plr.contract';

/**
 * Select the existing per-workflow contract, role and emergency-scope properties.
 * @param tab - Selected registered workflow.
 * @param fields - Existing operation inputs: {contract, profile, roles}.
 * @returns The selected workflow properties; unrelated workflows receive an empty object.
 */
function tabProps(tab, fields) {
  const { contract, profile, roles } = fields;

  // What the operator suspends at once (D25): 'own', 'selected', 'all' or ''.
  if (tab.key === 'lifecycle')
    return { roles, emergencyScope: profile?.emergency_suspension_scope || '' };
  // The issue tab reads a new certificate's record on the contract (D36).
  if (tab.key === 'governance' || tab.key === 'audit' || tab.key === 'issue') return { contract };
  return {};
}

/**
 * Restore the operator session and render the authorized route within the existing console shell.
 * @returns The rendered React content.
 */
function OperatorApplication() {
  const { lang, t: translate } = useI18n();
  const location = useLocation();
  const [authed, setAuthed] = useState(signedIn());
  const [contract, setContract] = useState(
    () => localStorage.getItem(CONTRACT_KEY) || import.meta.env.VITE_GOVERNANCE_CONTRACT || '',
  );
  const [expired, setExpired] = useState(false);
  const [profile, setProfile] = useState(null);
  // What awaits the user, asked once when they sign in - not on every page
  // load, and not polled.
  const [notices, setNotices] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!authed) {
      setProfile(null);
      return undefined;
    }
    setProfile(null);
    me()
      .then((next) => alive && setProfile(next))
      .catch(() => alive && setProfile({ roles: [], governance_roles: [] }));
    return () => {
      alive = false;
    };
  }, [authed]);

  useEffect(() => {
    // Why, when the back-office said (a revoked accreditation, D24).
    const onExpired = (event) => {
      setExpired(event?.detail?.message || true);
      setAuthed(false);
    };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  const roles = profile?.roles ?? [];
  // The back-office names the contract it proposes on; the console then reads
  // and votes on that one. A pasted or build-time address is only for a
  // back-office that names none.
  const ownContract = profile?.governance_contract || '';
  const shownContract = ownContract || contract;
  const changeContract = ownContract
    ? undefined
    : (value) => {
        localStorage.setItem(CONTRACT_KEY, value);
        setContract(value);
      };
  const loadingProfile = authed && profile === null;
  const routePath = normalizeRoutePath(location.pathname);
  const routes = APP_ROUTES.map((item) => ({
    ...item,
    label: translate(item.labelKey),
    description: translate(item.descriptionKey),
  }));
  const {
    activeRoute: page,
    redirectPath,
    visible,
  } = resolveAppRoute({
    routes,
    roles,
    pathname: routePath,
    loadingProfile,
  });
  const active = page?.key;
  const ActiveTab = page?.Component;

  useEffect(() => {
    document.title = `Atest · ${page ? page.label : t('Register odbornej spôsobilosti')}`;
  }, [page]);

  if (!authed) {
    return (
      <Login
        expired={expired}
        onDone={() => {
          setExpired(false);
          setAuthed(true);
          notifications()
            .then(setNotices)
            .catch(() => setNotices(null));
        }}
      />
    );
  }

  if (loadingProfile) {
    return (
      <AppShell
        active={active}
        contract={shownContract}
        onContract={changeContract}
        onSignOut={() => {
          setNotices(null);
          setAuthed(false);
        }}
        page={page}
        profile={profile}
        roles={roles}
        tabs={[]}
      >
        <Notice>{t('Načítava sa profil používateľa.')}</Notice>
      </AppShell>
    );
  }

  if (!page) {
    return <Navigate to={routeLocation(redirectPath, location.search)} replace />;
  }

  return (
    <AppShell
      active={active}
      contract={shownContract}
      onContract={changeContract}
      onSignOut={() => {
        setNotices(null);
        setAuthed(false);
      }}
      notices={notices}
      onCloseNotices={() => setNotices(null)}
      page={page}
      profile={profile}
      roles={roles}
      tabs={visible}
    >
      <ErrorBoundary resetKey={`${location.pathname}:${location.search}:${lang}`}>
        {ActiveTab && (
          <ActiveTab {...tabProps(page, { contract: shownContract, profile, roles })} />
        )}
      </ErrorBoundary>
    </AppShell>
  );
}
