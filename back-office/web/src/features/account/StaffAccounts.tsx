import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { FormEvent } from 'react';
import type { StaffAccount, StaffAccountOptions } from '../../../../shared/staff-accounts.ts';
import type { OperatorPage } from '../../../../shared/operator-accounts.ts';
import {
  staffAccountOptions,
  staffAccountList,
  staffAccount,
} from '../../shared/api/staffAccounts.ts';
import { signedIn, signOut, SESSION_EXPIRED } from '../../shared/api/auth.ts';
import { t } from '../../shared/i18n/index.ts';
import Login from '../../app/Login.tsx';
import { Brand, LanguageSwitch } from '../../app/Sidebar.tsx';
import Button from '../../shared/ui/Button.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import Field from '../../shared/ui/Field.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Table from '../../shared/ui/Table.tsx';
import StaffAccountEditor from './StaffAccountEditor.tsx';

/**
 * Render the existing user-administration list, create and account-edit routes.
 * @returns A session gate and administration screen using live server permissions.
 * @remarks The operator console's normal navigation/design stays unchanged. Old
 * admin routes remain direct URLs while the replacement is verified separately.
 */
export default function StaffAccounts() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(signedIn);
  const [authority, setAuthority] = useState<StaffAccountOptions | null>(null);
  const [loadedRoute, setLoadedRoute] = useState('');
  const [page, setPage] = useState<OperatorPage>({ results: [], total: 0, next: null });
  const [selected, setSelected] = useState<StaffAccount | undefined>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState(new URLSearchParams(location.search).get('q') ?? '');
  const creating = /\/add\/?$/.test(location.pathname);
  const accountId = /^\/admin\/auth\/user\/([1-9]\d*)\/(?:change|delete|password)\/?$/.exec(
    location.pathname,
  )?.[1];
  const offset = Math.max(0, Number(new URLSearchParams(location.search).get('offset')) || 0);
  const route = location.pathname + location.search;

  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);

  useEffect(() => {
    let current = true;
    setAuthority(null);
    setSelected(undefined);
    setError('');
    if (!authenticated) {
      setPage({ results: [], total: 0, next: null });
      return;
    }
    void (async () => {
      try {
        const options = await staffAccountOptions();
        const row = accountId ? await staffAccount(Number(accountId)) : undefined;
        const rows =
          !creating && !accountId && options.can_view
            ? await staffAccountList(new URLSearchParams(location.search).get('q') ?? '', offset)
            : { results: [], total: 0, next: null };
        if (!current) return;
        setAuthority(options);
        setSelected(row);
        setPage(rows);
        setLoadedRoute(route);
      } catch (failure) {
        if (current)
          setError(
            failure instanceof Error ? failure.message : t('Administrácia nie je dostupná.'),
          );
      }
    })();
    return () => {
      current = false;
    };
  }, [authenticated, location.pathname, location.search]);

  /**
   * Navigate to a fresh bounded search without retaining old pagination.
   * @param event - Search form submission.
   * @returns No return value; updates the administration route.
   */
  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigate('/admin/auth/user/?' + new URLSearchParams({ q: search }));
  }

  /**
   * Apply a committed response and sign out when the acting account's session changed.
   * @param account - Public account returned after the server committed the edit.
   * @returns No return value; updates navigation or the authentication gate.
   */
  function saved(account: StaffAccount): void {
    if (account.id === authority?.actor_id) {
      signOut();
      setAuthenticated(false);
      setMessage(t('Účet bol zmenený. Prihláste sa znova.'));
    } else {
      setMessage(t('Účet bol uložený.'));
      navigate(`/admin/auth/user/${account.id}/change/`, { replace: true });
      setSelected(account);
    }
  }

  if (!authenticated)
    return (
      <Login
        expired={message || undefined}
        onDone={() => {
          setMessage('');
          setLoadedRoute('');
          setAuthenticated(true);
        }}
      />
    );
  return (
    <main className="main">
      <header className="page-head">
        <Brand />
        <LanguageSwitch />
        <h1>{t('Správa účtov')}</h1>
        <Link to="/">{t('Späť do konzoly')}</Link>{' '}
        <Link to="/admin/auth/group/">{t('Skupiny')}</Link>{' '}
        <Button
          variant="ghost"
          onClick={() => {
            signOut();
            setAuthenticated(false);
          }}
        >
          {t('Odhlásiť')}
        </Button>
      </header>
      {message && <Notice tone="ok">{message}</Notice>}
      {error && <Notice tone="err">{error}</Notice>}
      {authority && loadedRoute === route && (
        <>
          {creating || selected ? (
            <>
              <Link to="/admin/auth/user/">{t('Zoznam účtov')}</Link>
              {creating && !authority.can_add ? (
                <Notice tone="err">{t('Nemáte oprávnenie vytvoriť účet.')}</Notice>
              ) : (
                <StaffAccountEditor
                  key={selected ? `${selected.id}:${selected.version}` : 'new'}
                  options={authority}
                  account={selected}
                  confirmDeletion={/\/delete\/?$/.test(location.pathname)}
                  onSaved={saved}
                  onDeleted={(account) => {
                    if (account.id === authority.actor_id) {
                      signOut();
                      setAuthenticated(false);
                    } else navigate('/admin/auth/user/', { replace: true });
                  }}
                />
              )}
            </>
          ) : (
            <>
              {authority.can_add && (
                <Link className="btn" to="/admin/auth/user/add/">
                  {t('Nový účet')}
                </Link>
              )}
              {authority.can_view && (
                <>
                  <form onSubmit={submitSearch}>
                    <Field id="account-search" label={t('Hľadať účet')}>
                      <TextInput
                        id="account-search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </Field>
                    <Button type="submit">{t('Hľadať')}</Button>
                  </form>
                  <p>
                    {t('Počet účtov')}: {page.total}
                  </p>
                  <Table>
                    <thead>
                      <tr>
                        <th>{t('Používateľ')}</th>
                        <th>{t('E-mail')}</th>
                        <th>{t('Aktívny účet')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.results.map((account) => (
                        <tr key={account.id}>
                          <td>
                            <Link to={`/admin/auth/user/${account.id}/change/`}>
                              {account.username}
                            </Link>
                          </td>
                          <td>{account.email}</td>
                          <td>{account.active ? t('Áno') : t('Nie')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {offset > 0 && (
                    <Link
                      to={
                        '/admin/auth/user/?' +
                        new URLSearchParams({
                          q: search,
                          offset: String(Math.max(0, offset - 100)),
                        })
                      }
                    >
                      {t('Predchádzajúca strana')}
                    </Link>
                  )}
                  {page.next !== null && (
                    <Link
                      to={
                        '/admin/auth/user/?' +
                        new URLSearchParams({ q: search, offset: String(page.next) })
                      }
                    >
                      {t('Ďalšia strana')}
                    </Link>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
