import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Login from '../../app/Login.tsx';
import { Brand, LanguageSwitch } from '../../app/Sidebar.tsx';
import { signedIn, signOut, SESSION_EXPIRED } from '../../shared/api/auth.ts';
import { staffAccountOptions } from '../../shared/api/staffAccounts.ts';
import { staffGroupOptions } from '../../shared/api/staffGroups.ts';
import { t } from '../../shared/i18n/index.ts';
import Button from '../../shared/ui/Button.tsx';
import Notice from '../../shared/ui/Notice.tsx';

/**
 * Render the administration entry point and retain safe local post-login destinations.
 * @returns Staff administration links and the existing login gate.
 */
export default function AdministrationHome() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(signedIn);
  const [accounts, setAccounts] = useState(false);
  const [groups, setGroups] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);
  useEffect(() => {
    let current = true;
    setLoaded(false);
    setAccounts(false);
    setGroups(false);
    if (!authenticated) return;
    void Promise.allSettled([staffAccountOptions(), staffGroupOptions()]).then((results) => {
      if (!current) return;
      setAccounts(results[0].status === 'fulfilled');
      setGroups(results[1].status === 'fulfilled');
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [authenticated]);
  if (!authenticated)
    return (
      <Login
        onDone={() => {
          setAuthenticated(true);
          const next = new URLSearchParams(location.search).get('next') ?? '/admin/';
          navigate(
            /^\/admin\/(?:auth\/(?:user|group)\/(?:add\/|[1-9]\d*\/change\/)?)?$/.test(next) ||
              next === '/admin/password_change/'
              ? next
              : '/admin/',
            { replace: true },
          );
        }}
      />
    );
  return (
    <main className="main">
      <header className="page-head">
        <Brand />
        <LanguageSwitch />
        <h1>{t('Administrácia')}</h1>
        <Link to="/">{t('Späť do konzoly')}</Link>{' '}
        <Link to="/admin/password_change/">{t('Zmeniť heslo')}</Link>{' '}
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
      {accounts && (
        <p>
          <Link to="/admin/auth/user/">{t('Správa účtov')}</Link>
        </p>
      )}
      {groups && (
        <p>
          <Link to="/admin/auth/group/">{t('Správa skupín')}</Link>
        </p>
      )}
      {loaded && !accounts && !groups && (
        <Notice>{t('Nemáte oprávnenie spravovať účty alebo skupiny.')}</Notice>
      )}
    </main>
  );
}
