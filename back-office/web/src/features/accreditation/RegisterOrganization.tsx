// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useState } from 'react';
import { registerOrganization } from '../../shared/api/accreditation.ts';
import Button from '../../shared/ui/Button.tsx';
import Field from '../../shared/ui/Field.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import { t } from '../../shared/i18n/index.ts';

/**
 * Register an organization's account with the invitation the trust chain gave
 * it (design decisions D15): a TAO selected by the RootTAO, or a TI selected by a
 * TAO. The account then signs in with the role its place allows. There is no
 * registering without an invitation.
 */
const REASONS = {
  InvalidInvitation: () =>
    t(
      'Pozvánka neplatí: je nesprávna, už použitá alebo vypršala. O novú požiadajte toho, kto vás vybral.',
    ),
  UsernameTaken: () => t('Toto používateľské meno je už obsadené.'),
  WeakPassword: () =>
    t(
      'Heslo musí mať 15 až 128 znakov. Použite menej predvídateľné heslo alebo dlhšiu frázu z nesúvisiacich slov.',
    ),
  InvalidFields: () =>
    t('Skontrolujte pozvánku a používateľské meno (písmená, číslice a znaky @.+-_).'),
};

/**
 * Render the existing invitation, username and repeated-password registration form.
 * @param options - Existing component inputs: {modeSwitch, onDone}.
 * @returns The rendered React content.
 */
export default function RegisterOrganization(options) {
  const { modeSwitch, onDone } = options;

  const [invitation, setInvitation] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * Submit the current form and retain its existing busy, success and refusal states.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password !== password2) {
      setError(t('Heslá sa nezhodujú.'));
      return;
    }
    setBusy(true);
    try {
      const done = await registerOrganization(invitation.trim(), username.trim(), password);
      onDone(done);
    } catch (e) {
      setError(REASONS[e.reason]?.() ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-card registration-card" onSubmit={submit}>
      {modeSwitch}
      <h2>{t('Registrácia organizácie')}</h2>
      <p className="hint">
        {t(
          'Pre TAO, ktorý vybral RootTAO, a pre TI, ktorú vybral TAO. Zadajte pozvánku, ktorú ste od neho dostali, a zvoľte si prihlasovacie údaje.',
        )}
      </p>
      <Field className="field" id="inv" label={t('Pozvánka')}>
        <TextInput
          id="inv"
          mono
          value={invitation}
          onChange={(e) => setInvitation(e.target.value)}
          placeholder={t('napr. XXXX-XXXX-XXXX')}
          required
          autoComplete="off"
        />
      </Field>
      <Field className="field" id="ru" label={t('Používateľské meno')}>
        <TextInput
          id="ru"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('napr. organizacia')}
          required
          autoComplete="username"
        />
      </Field>
      <Field className="field" id="rp" label={t('Heslo')}>
        <TextInput
          id="rp"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('Minimálne 15 znakov')}
          required
          autoComplete="new-password"
        />
      </Field>
      <Field className="field" id="rp2" label={t('Zopakujte heslo')}>
        <TextInput
          id="rp2"
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          placeholder={t('Zadajte heslo znova')}
          required
          autoComplete="new-password"
        />
      </Field>
      <Button block disabled={busy} type="submit">
        {busy ? t('Registruje sa…') : t('Registrovať')}
      </Button>
      {error && <Notice tone="err">{error}</Notice>}
    </form>
  );
}
