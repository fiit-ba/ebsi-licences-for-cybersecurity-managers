// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import AccreditationTab from '../../features/accreditation/AccreditationTab.tsx';
import AuditTab from '../../features/audit/AuditTab.tsx';
import GovernanceTab from '../../features/governance/GovernanceTab.tsx';
import IssueTab from '../../features/issue/IssueTab.tsx';
import LifecycleTab from '../../features/lifecycle/LifecycleTab.tsx';
import SchemasTab from '../../features/schemas/SchemasTab.tsx';
import VerifyTab from '../../features/verify/VerifyTab.tsx';

/**
 * The app routes are intentionally whitelisted here. A URL path may select one
 * of these pages, but never an arbitrary component or any sensitive state.
 */
export const APP_ROUTES = [
  {
    key: 'issue',
    path: '/issue',
    icon: 'issue',
    labelKey: 'Vydanie',
    roles: ['plr_issuer'],
    descriptionKey: 'Registrácia certifikátov a odovzdanie ponuky do peňaženky držiteľa.',
    Component: IssueTab,
  },
  {
    key: 'lifecycle',
    path: '/lifecycle',
    icon: 'lifecycle',
    labelKey: 'Životný cyklus',
    // The TAO and the RootTAO come here to suspend at once (D25).
    roles: ['plr_issuer', 'plr_status_manager', 'plr_auditor', 'plr_tao', 'plr_rtao'],
    descriptionKey: 'Pozastavenie, odňatie a obnovenie certifikátov podľa štvor-okého princípu.',
    Component: LifecycleTab,
  },
  {
    key: 'verify',
    path: '/verify',
    icon: 'verify',
    labelKey: 'Overenie',
    roles: ['plr_verifier'],
    descriptionKey: 'Overenie certifikátu predloženého z peňaženky držiteľa.',
    Component: VerifyTab,
  },
  {
    key: 'governance',
    path: '/governance',
    icon: 'governance',
    labelKey: 'Riadenie',
    roles: null,
    descriptionKey: 'Hlasovanie o návrhoch a pravidlách kontraktu riadenia na ledgeri.',
    Component: GovernanceTab,
  },
  {
    key: 'schemas',
    path: '/schemas',
    icon: 'schemas',
    labelKey: 'Schémy',
    roles: ['plr_rtao', 'plr_tao', 'plr_auditor'],
    descriptionKey: 'Druhy certifikátov a ich atribúty. Určuje ich RootTAO a registrujú sa v TSR.',
    Component: SchemasTab,
  },
  {
    key: 'accreditation',
    path: '/accreditation',
    icon: 'accreditation',
    labelKey: 'Akreditácia',
    roles: ['plr_rtao', 'plr_tao'],
    descriptionKey:
      'Reťazec dôvery: RootTAO vyberá TAO, TAO vyberá TI a prideľuje im schémy, ktoré smú vydávať.',
    Component: AccreditationTab,
  },
  {
    key: 'audit',
    path: '/audit',
    icon: 'audit',
    labelKey: 'Audit',
    roles: ['plr_auditor'],
    descriptionKey: 'Auditný záznam, ukotvené rozhodnutia a overenie návrhov na chaine.',
    Component: AuditTab,
  },
];

/**
 * Keep routes available to at least one of the current operator roles.
 * @param routes - Explicitly registered operator routes.
 * @param roles - Current role assignments or available organizational roles.
 * @returns The allowed routes in their original order.
 */
export function visibleRoutes(routes, roles) {
  return routes.filter((item) => !item.roles || item.roles.some((role) => roles.includes(role)));
}

/**
 * Find an explicitly registered route matching the requested path.
 * @param routes - Explicitly registered operator routes.
 * @param pathname - Requested application path.
 * @returns The matching route, or null when the path is not registered.
 */
export function routeForPath(routes, pathname) {
  return routes.find((item) => item.path === pathname) || null;
}

/**
 * Resolve the current page and its existing role-aware fallback destination.
 * @param options - Existing operation inputs: {routes, roles, pathname, loadingProfile}.
 * @returns The active route, optional redirect destination and visible routes.
 */
export function resolveAppRoute(options) {
  const { routes, roles, pathname, loadingProfile } = options;

  const visible = visibleRoutes(routes, roles);
  const requested = routeForPath(routes, pathname);

  if (loadingProfile) {
    return {
      activeRoute: requested || routes[0] || null,
      redirectPath: '',
      visible,
    };
  }

  const activeRoute = routeForPath(visible, pathname);
  return {
    activeRoute,
    redirectPath: activeRoute ? '' : visible[0]?.path || '/governance',
    visible,
  };
}
