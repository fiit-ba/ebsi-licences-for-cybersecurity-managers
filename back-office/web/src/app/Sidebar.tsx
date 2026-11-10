// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LANG_NAMES, LANGS, t, useI18n } from '../shared/i18n/index.ts';
import { currentUser, signOut } from '../shared/api/auth.ts';
import { PLACE } from '../shared/places.ts';
import Icon from '../shared/ui/Icon.tsx';
import { replaceSearchParam, routeLocation } from './routing/url.ts';
import StatusBar from './StatusBar.tsx';

/**
 * Render the existing Atest wordmark and bundled brand symbol.
 * @returns The rendered React content.
 */
export function Brand() {
  return (
    <div className="brand">
      <img src="/brand-mark.svg" alt="" width="36" height="36" />
      <div>
        <div className="brand-name">Atest</div>
        <div className="brand-sub">{t('Register · back-office')}</div>
      </div>
    </div>
  );
}

/**
 * SK | EN. The switch updates the React language context without reloading.
 * @param options - Existing component inputs: {tone}.
 * @returns The rendered React content.
 */
export function LanguageSwitch(options: { tone?: string }) {
  const { tone } = options;

  const { lang, setLang } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Apply the selected console language without reloading the current workflow.
   * @param code - Existing role, language or refusal code selected by the caller.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function chooseLang(code) {
    setLang(code);
    const search = replaceSearchParam(location.search, 'lang', code);
    if (search === location.search) return;
    navigate(routeLocation(location.pathname, search), { replace: true });
  }

  return (
    <div className={`lang ${tone || ''}`} role="radiogroup" aria-label={t('Jazyk')}>
      {LANGS.map((code) => (
        <button
          key={code}
          role="radio"
          type="button"
          aria-checked={code === lang}
          aria-label={LANG_NAMES[code]}
          onClick={() => chooseLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/**
 * Render authorized navigation, current operator details, language selection and ledger status.
 * @param options - Existing component inputs: {active, contract, onContract, onSignOut, profile, tabs}.
 * @returns The rendered React content.
 */
export default function Sidebar(options) {
  const { active, contract, onContract, onSignOut, profile, tabs } = options;

  // Where this account stands in the trust chain, if it registered for an
  // organization; staff accounts have no place and show none.
  const place = PLACE[profile?.organization_kind];
  const { search } = useLocation();
  return (
    <aside className="sidebar">
      <Brand />

      <nav className="nav" aria-label={t('Sekcie')}>
        {tabs.map(({ key, path, icon, label }) => (
          <NavLink
            key={key}
            data-tab={key}
            end
            to={routeLocation(path, search)}
            aria-current={active === key ? 'page' : undefined}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-foot">
        <StatusBar contract={contract} onContract={onContract} />
        <div className="account-panel">
          <div className="user">
            <span className="avatar" aria-hidden="true">
              {(currentUser() || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="user-name">
              {currentUser()}
              {place && (
                <span className="user-place" title={profile.organization}>
                  <span className="place-badge">{place}</span>
                  <span className="place-org">{profile.organization}</span>
                </span>
              )}
            </span>
          </div>
          <div className="account-actions">
            <LanguageSwitch />
            <button
              className="signout-btn"
              type="button"
              onClick={() => {
                signOut();
                onSignOut();
              }}
            >
              <Icon name="logout" />
              <span>{t('Odhlásiť')}</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
