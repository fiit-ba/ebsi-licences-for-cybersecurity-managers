// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useState } from 'react';
import { signIn } from '../shared/api/auth.ts';
import RegisterOrganization from '../features/accreditation/RegisterOrganization.tsx';
import { t } from '../shared/i18n/index.ts';
import Button from '../shared/ui/Button.tsx';
import Field from '../shared/ui/Field.tsx';
import Icon from '../shared/ui/Icon.tsx';
import Notice from '../shared/ui/Notice.tsx';
import TextInput from '../shared/ui/TextInput.tsx';
import { Brand, LanguageSwitch } from './Sidebar.tsx';

const DEV_PASSWORDS = import.meta.env.DEV
  ? {
      alice: 'Atest-2026!Demo',
      bob: 'Atest-2026!Demo',
      supervisor: 'Atest-2026!Demo',
      mirri: 'Atest-2026!Demo',
    }
  : {};
const DEV_PASSWORD_VALUES = new Set(Object.values(DEV_PASSWORDS));

/**
 * Look up the existing development-only password hint for a seeded username.
 * @param username - Operator username.
 * @returns The existing development hint or an empty value for an unknown account.
 */
function devPasswordFor(username) {
  return DEV_PASSWORDS[String(username).trim().toLowerCase()] || '';
}

/**
 * Check whether the current value is one of the development-only password hints.
 * @param value - Current input or state value.
 * @returns Whether the supplied password equals an existing development hint.
 */
function isDevPassword(value) {
  return DEV_PASSWORD_VALUES.has(value);
}

/**
 * Render the existing sign-in and organization-registration mode selector.
 * @param options - Existing component inputs: {registering, onChange}.
 * @returns The rendered React content.
 */
function AuthModeSwitch(options) {
  const { registering, onChange } = options;

  return (
    <div className="auth-mode-switch" role="tablist" aria-label={t('Spôsob prístupu')}>
      <button
        type="button"
        role="tab"
        aria-selected={!registering}
        className={!registering ? 'active' : ''}
        onClick={() => onChange(false)}
      >
        {t('Prihlásenie')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={registering}
        className={registering ? 'active' : ''}
        onClick={() => onChange(true)}
      >
        {t('Registrácia')}
      </button>
    </div>
  );
}

/**
 * Render the existing sign-in form and invitation-based organization registration.
 * @param options - Existing component inputs: {onDone, expired}.
 * @returns The rendered React content.
 */
export default function Login(options) {
  const { onDone, expired } = options;

  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState(() => devPasswordFor('alice'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // An organization the trust chain selected registers here with its
  // invitation (design decisions D15), then signs in.
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(null);

  /**
   * Update the username and its existing development-only password hint together.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function changeUsername(event) {
    const next = event.target.value;
    setUsername(next);
    setPassword((current) => {
      const devPassword = devPasswordFor(next);
      if (devPassword) return devPassword;
      return isDevPassword(current) ? '' : current;
    });
  }

  /**
   * Submit the current form and retain its existing busy, success and refusal states.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(username, password);
      onDone();
    } catch (e) {
      setError(e.message);
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
          <h1>{t('Register odbornej spôsobilosti')}</h1>
          <p>
            {t(
              'Back-office konzola pre certifikačné orgány, správcov statusov, overovateľov a audítorov.',
            )}
          </p>
          <ul>
            <li>
              <Icon name="check" />
              {t('Vydávanie certifikátov do peňaženky EBSI')}
            </li>
            <li>
              <Icon name="check" />
              {t('Štvor-oký princíp a riadenie na ledgeri')}
            </li>
            <li>
              <Icon name="check" />
              {t('Overenie a audit každého rozhodnutia')}
            </li>
          </ul>
        </div>
        <p className="login-hero-foot">{t('Manažér kybernetickej bezpečnosti')}</p>
      </section>

      <section className="login-side">
        {registering ? (
          <RegisterOrganization
            modeSwitch={<AuthModeSwitch registering onChange={setRegistering} />}
            onDone={(done) => {
              setRegistered(done);
              setUsername(done.username);
              setPassword(devPasswordFor(done.username));
              setRegistering(false);
            }}
          />
        ) : (
          <form className="login-card" onSubmit={submit}>
            <AuthModeSwitch registering={false} onChange={setRegistering} />
            <h2>{t('Prihlásenie')}</h2>
            <p className="hint">{t('Back-office konzola registra odbornej spôsobilosti.')}</p>

            {typeof expired === 'string' ? (
              <Notice tone="err">{expired}</Notice>
            ) : (
              expired && (
                <Notice>
                  {t('Relácia vypršala po 15 minútach nečinnosti. Prihláste sa znova.')}
                </Notice>
              )
            )}

            <Field className="field" id="u" label={t('Používateľ')}>
              <TextInput
                id="u"
                autoComplete="username"
                value={username}
                onChange={changeUsername}
                placeholder={t('napr. alice')}
              />
            </Field>
            <Field className="field" id="p" label={t('Heslo')}>
              <TextInput
                id="p"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('Zadajte heslo')}
              />
            </Field>

            <Button block disabled={busy} type="submit">
              {busy ? t('Prihlasuje sa…') : t('Prihlásiť')}
            </Button>

            {error && <Notice tone="err">{error}</Notice>}

            {registered && (
              <Notice tone="ok">
                {t('Organizácia {0} je registrovaná. Prihláste sa.', [registered.organization])}
              </Notice>
            )}

            {import.meta.env.DEV && (
              <p className="footnote">
                {t('Vývojové prostredie:')} <code>alice</code> {t('vydáva a spravuje statusy,')}{' '}
                <code>bob</code> {t('spravuje statusy,')} <code>supervisor</code>{' '}
                {t('je audítor a RootTAO,')} <code>mirri</code> {t('je TAO — vytvára ich')}{' '}
                <code>infra/bootstrap.sh</code>
                {t(
                  '. Štvor-oký princíp vyžaduje, aby návrh a schválenie robili dvaja rôzni ľudia.',
                )}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
