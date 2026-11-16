import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type {
  StaffGroup,
  StaffGroupOptions,
  StaffGroupPage,
} from '../../../../shared/staff-groups.ts';
import { staffGroupOptions, staffGroups, staffGroup } from '../../shared/api/staffGroups.ts';
import { signedIn, signOut, SESSION_EXPIRED } from '../../shared/api/auth.ts';
import { t } from '../../shared/i18n/index.ts';
import Login from '../../app/Login.tsx';
import { Brand, LanguageSwitch } from '../../app/Sidebar.tsx';
import Button from '../../shared/ui/Button.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import Field from '../../shared/ui/Field.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Table from '../../shared/ui/Table.tsx';
import StaffGroupEditor from './StaffGroupEditor.tsx';

/**
 * Render group administration through its existing list, add and edit URLs.
 * @returns A session gate and permission-aware group workflow.
 */
export default function StaffGroups() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = location.pathname + location.search;
  const creating = /\/add\/?$/.test(location.pathname);
  const id = /^\/admin\/auth\/group\/([1-9]\d*)\/(?:change|delete)\/?$/.exec(
    location.pathname,
  )?.[1];
  const [authenticated, setAuthenticated] = useState(signedIn);
  const [loaded, setLoaded] = useState('');
  const [options, setOptions] = useState<StaffGroupOptions | null>(null);
  const [selected, setSelected] = useState<StaffGroup | undefined>();
  const [page, setPage] = useState<StaffGroupPage>({ results: [], total: 0, next: null });
  const [search, setSearch] = useState(new URLSearchParams(location.search).get('q') ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);
  useEffect(() => {
    let current = true;
    setError('');
    setOptions(null);
    setSelected(undefined);
    if (!authenticated) return;
    void (async () => {
      try {
        const authority = await staffGroupOptions();
        const group = id ? await staffGroup(Number(id)) : undefined;
        const rows =
          !creating && !id && authority.can_view
            ? await staffGroups(location.search)
            : { results: [], total: 0, next: null };
        if (!current) return;
        setOptions(authority);
        setSelected(group);
        setPage(rows);
        setLoaded(route);
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
  }, [authenticated, route]);

  if (!authenticated)
    return (
      <Login
        onDone={() => {
          setLoaded('');
          setAuthenticated(true);
        }}
      />
    );
  return (
    <main className="main">
      <header className="page-head">
        <Brand />
        <LanguageSwitch />
        <h1>{t('Správa skupín')}</h1>
        <Link to="/admin/auth/user/">{t('Zoznam účtov')}</Link>{' '}
        <Link to="/">{t('Späť do konzoly')}</Link>{' '}
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
      {error && <Notice tone="err">{error}</Notice>}
      {options &&
        loaded === route &&
        (creating || selected ? (
          <>
            <Link to="/admin/auth/group/">{t('Zoznam skupín')}</Link>
            <StaffGroupEditor
              key={selected ? `${selected.id}:${selected.version}` : 'new'}
              options={options}
              group={selected}
              confirmDeletion={/\/delete\/?$/.test(location.pathname)}
              onSaved={(group) => {
                setSelected(group);
                navigate(`/admin/auth/group/${group.id}/change/`, { replace: true });
              }}
              onDeleted={() => navigate('/admin/auth/group/', { replace: true })}
            />
          </>
        ) : (
          <>
            {options.can_add && (
              <Link className="btn" to="/admin/auth/group/add/">
                {t('Nová skupina')}
              </Link>
            )}
            {options.can_view && (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    navigate('/admin/auth/group/?' + new URLSearchParams({ q: search }));
                  }}
                >
                  <Field id="group-search" label={t('Hľadať skupinu')}>
                    <TextInput
                      id="group-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </Field>
                  <Button type="submit">{t('Hľadať')}</Button>
                </form>
                <p>
                  {t('Počet skupín')}: {page.total}
                </p>
                <Table>
                  <thead>
                    <tr>
                      <th>{t('Názov skupiny')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.results.map((group) => (
                      <tr key={group.id}>
                        <td>
                          <Link to={`/admin/auth/group/${group.id}/change/`}>{group.name}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {Number(new URLSearchParams(location.search).get('offset')) > 0 && (
                  <Link
                    to={
                      '/admin/auth/group/?' +
                      new URLSearchParams({
                        q: search,
                        offset: String(
                          Math.max(
                            0,
                            Number(new URLSearchParams(location.search).get('offset')) - 100,
                          ),
                        ),
                      })
                    }
                  >
                    {t('Predchádzajúca strana')}
                  </Link>
                )}
                {page.next !== null && (
                  <Link
                    to={
                      '/admin/auth/group/?' +
                      new URLSearchParams({ q: search, offset: String(page.next) })
                    }
                  >
                    {t('Ďalšia strana')}
                  </Link>
                )}
              </>
            )}
          </>
        ))}
    </main>
  );
}
