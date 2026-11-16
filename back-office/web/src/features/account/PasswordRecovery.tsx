import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Brand, LanguageSwitch } from '../../app/Sidebar.tsx';
import {
  requestPasswordReset,
  validatePasswordReset,
  confirmPasswordReset,
} from '../../shared/api/passwordRecovery.ts';
import { signOut } from '../../shared/api/session.ts';
import { t } from '../../shared/i18n/index.ts';
import Button from '../../shared/ui/Button.tsx';
import Field from '../../shared/ui/Field.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import Notice from '../../shared/ui/Notice.tsx';

/**
 * Render the existing email recovery workflow using the operator client's visual controls.
 * @returns A public request, link-validation or password-confirmation screen.
 * @remarks The bearer lives only in the URL fragment and component memory. It is
 * removed from browser history after success and never written to browser storage.
 */
export default function PasswordRecovery() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = location.hash.slice(1);
  const completed = location.pathname.replace(/\/$/, '') === '/password_reset/complete';
  const requestDone = location.pathname.replace(/\/$/, '') === '/password_reset/done';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [validating, setValidating] = useState(Boolean(token));
  const [valid, setValid] = useState(!token);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let current = true;
    validatePasswordReset(token)
      .then(() => {
        if (current) setValid(true);
      })
      .catch(() => {
        if (current) setError(t('Odkaz na obnovu hesla je neplatný alebo vypršal.'));
      })
      .finally(() => {
        if (current) setValidating(false);
      });
    return () => {
      current = false;
    };
  }, [token]);

  /**
   * Submit the current recovery step without retaining password or bearer data.
   * @param event - Native form submission event.
   * @returns Completion after acknowledgement or rendering the server refusal.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !valid) return;
    setError('');
    if (token && password !== repeated) {
      setError(t('Heslá sa nezhodujú.'));
      return;
    }
    setBusy(true);
    try {
      if (token) {
        await confirmPasswordReset(token, password);
        signOut();
        setPassword('');
        setRepeated('');
        navigate('/password_reset/complete', { replace: true });
      } else {
        await requestPasswordReset(email);
        setSent(true);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Obnova hesla sa nepodarila.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-hero-top">
          <Brand />
          <LanguageSwitch tone="on-dark" />
        </div>
        <div className="login-hero-body">
          <h1>{t('Obnova hesla')}</h1>
          <p>{t('Register odbornej spôsobilosti')}</p>
        </div>
      </section>
      <section className="login-side">
        <form className="login-card" onSubmit={submit}>
          <h2>{t('Obnova hesla')}</h2>
          {completed ? (
            <Notice tone="ok">{t('Heslo bolo zmenené. Prihláste sa novým heslom.')}</Notice>
          ) : sent || requestDone ? (
            <Notice tone="ok">
              {t('Ak je účet oprávnený na obnovu, dostanete e-mail s odkazom.')}
            </Notice>
          ) : validating ? (
            <Notice>{t('Overujem odkaz…')}</Notice>
          ) : (
            valid && (
              <>
                {token ? (
                  <>
                    <Field id="new-password" label={t('Nové heslo')}>
                      <TextInput
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Field id="repeat-password" label={t('Potvrďte nové heslo')}>
                      <TextInput
                        id="repeat-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={repeated}
                        onChange={(event) => setRepeated(event.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <Field id="recovery-email" label={t('E-mail')}>
                    <TextInput
                      id="recovery-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>
                )}
                <Button block type="submit" disabled={busy}>
                  {busy ? t('Spracúvam…') : token ? t('Zmeniť heslo') : t('Odoslať odkaz')}
                </Button>
              </>
            )
          )}
          {error && <Notice tone="err">{error}</Notice>}
          <Link to="/">{t('Späť na prihlásenie')}</Link>
        </form>
      </section>
    </div>
  );
}
