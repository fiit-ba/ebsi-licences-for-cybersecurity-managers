import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { backendRequest } from '../../shared/api/client.ts';
import { signedIn, signOut } from '../../shared/api/auth.ts';
import { t } from '../../shared/i18n/index.ts';
import Login from '../../app/Login.tsx';
import { Brand, LanguageSwitch } from '../../app/Sidebar.tsx';
import Field from '../../shared/ui/Field.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import Button from '../../shared/ui/Button.tsx';
import Notice from '../../shared/ui/Notice.tsx';

/**
 * Render the existing staff self-service password change without model-edit privileges.
 * @returns Current-password verification, matching new-password fields and sign-in on success.
 */
export default function StaffPassword() {
  const [authenticated, setAuthenticated] = useState(signedIn);
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Change the current staff user's password and clear all local credential state.
   * @param event - Native form submission.
   * @returns Completion after sign-out or a visible server refusal.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (password !== repeated) {
      setError(t('Heslá sa nezhodujú.'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      await backendRequest('/admin/password-change/', {
        method: 'POST',
        body: { old_password: oldPassword, new_password1: password, new_password2: repeated },
      });
      signOut();
      setOldPassword('');
      setPassword('');
      setRepeated('');
      setDone(true);
      setAuthenticated(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Obnova hesla sa nepodarila.'));
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated)
    return (
      <Login
        expired={done ? t('Heslo bolo zmenené. Prihláste sa novým heslom.') : undefined}
        onDone={() => {
          setDone(false);
          setAuthenticated(true);
        }}
      />
    );
  return (
    <main className="main">
      <header className="page-head">
        <Brand />
        <LanguageSwitch />
        <h1>{t('Zmeniť heslo')}</h1>
        <Link to="/admin/">{t('Administrácia')}</Link>
      </header>
      <form className="login-card" onSubmit={submit}>
        <Field id="current-password" label={t('Súčasné heslo')}>
          <TextInput
            id="current-password"
            type="password"
            required
            autoComplete="current-password"
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
          />
        </Field>
        <Field id="change-password" label={t('Nové heslo')}>
          <TextInput
            id="change-password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field id="repeat-change-password" label={t('Potvrďte nové heslo')}>
          <TextInput
            id="repeat-change-password"
            type="password"
            required
            autoComplete="new-password"
            value={repeated}
            onChange={(event) => setRepeated(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {t('Zmeniť heslo')}
        </Button>
        {error && <Notice tone="err">{error}</Notice>}
      </form>
    </main>
  );
}
