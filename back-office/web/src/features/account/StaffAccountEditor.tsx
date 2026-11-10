import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  StaffAccount,
  StaffAccountEdit,
  StaffAccountOptions,
} from '../../../../shared/staff-accounts.ts';
import { saveStaffAccount, deleteStaffAccount } from '../../shared/api/staffAccounts.ts';
import { t } from '../../shared/i18n/index.ts';
import Field from '../../shared/ui/Field.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import Checkbox from '../../shared/ui/Checkbox.tsx';
import Button from '../../shared/ui/Button.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';

/** Current administration authority, optional existing row and committed-save callback. */
interface EditorProps {
  options: StaffAccountOptions;
  account?: StaffAccount;
  onSaved: (account: StaffAccount) => void;
  onDeleted: (account: StaffAccount) => void;
  confirmDeletion?: boolean;
}

/**
 * Render account personal-data, password and authorized membership controls.
 * @param props - Current server authority, versioned account and save callback.
 * @returns The existing account-management workflow using the console form controls.
 * @remarks Client restrictions are presentation only; the server rechecks all grants.
 * Passwords remain component state until submission and are cleared on success.
 */
export default function StaffAccountEditor(props: EditorProps) {
  const { options, account, onSaved, onDeleted } = props;
  const [draft, setDraft] = useState<StaffAccountEdit>(() => ({
    username: account?.username ?? '',
    email: account?.email ?? '',
    first_name: account?.first_name ?? '',
    last_name: account?.last_name ?? '',
    active: account?.active ?? true,
    is_staff: account?.is_staff ?? false,
    is_superuser: account?.is_superuser ?? false,
    group_ids: account?.group_ids ?? [],
    permission_ids: account?.permission_ids ?? [],
  }));
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(props.confirmDeletion ?? false);
  const editable = account ? options.can_change : options.can_add;

  /**
   * Update one explicitly writable form value.
   * @param field - Draft field name.
   * @param value - Value with the same type as the selected field.
   * @returns No return value; updates component-owned form state.
   */
  function change<Key extends keyof StaffAccountEdit>(
    field: Key,
    value: StaffAccountEdit[Key],
  ): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  /**
   * Toggle one group or direct-permission choice in the local draft.
   * @param field - Membership list being edited.
   * @param id - Selected group or permission ID.
   * @param checked - Whether the explicit membership should be present.
   * @returns No return value; updates the local membership list.
   */
  function toggle(field: 'group_ids' | 'permission_ids', id: number, checked: boolean): void {
    setDraft((current) => ({
      ...current,
      [field]: checked ? [...current[field], id] : current[field].filter((value) => value !== id),
    }));
  }

  /**
   * Submit the current edit version and render any actionable server refusal.
   * @param event - Native form submission.
   * @returns Completion after a committed save or displayed refusal.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !editable) return;
    setError('');
    if (password !== repeated) {
      setError(t('Heslá sa nezhodujú.'));
      return;
    }
    setBusy(true);
    try {
      const saved = await saveStaffAccount({
        ...draft,
        ...(account ? { account_id: account.id, version: account.version } : {}),
        ...(password ? { password } : {}),
      });
      setPassword('');
      setRepeated('');
      onSaved(saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Účet sa nepodarilo uložiť.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Remove the displayed version after an explicit confirmation step.
   * @returns Completion after deletion/navigation or a visible server refusal.
   */
  async function remove(): Promise<void> {
    if (!account || !options.can_delete || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteStaffAccount(account);
      onDeleted(account);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Účet sa nepodarilo vymazať.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={account ? account.username : t('Nový účet')}>
      <form onSubmit={submit}>
        <fieldset disabled={!editable || busy}>
          <Field id="account-username" label={t('Používateľ')}>
            <TextInput
              id="account-username"
              value={draft.username}
              autoComplete="off"
              required
              onChange={(event) => change('username', event.target.value)}
            />
          </Field>
          <Field id="account-email" label={t('E-mail')}>
            <TextInput
              id="account-email"
              type="email"
              value={draft.email}
              required={!account}
              maxLength={account ? 254 : 100}
              onChange={(event) => change('email', event.target.value)}
            />
          </Field>
          <Field id="account-first" label={t('Meno')}>
            <TextInput
              id="account-first"
              value={draft.first_name}
              onChange={(event) => change('first_name', event.target.value)}
            />
          </Field>
          <Field id="account-last" label={t('Priezvisko')}>
            <TextInput
              id="account-last"
              value={draft.last_name}
              onChange={(event) => change('last_name', event.target.value)}
            />
          </Field>
          <Field
            id="account-password"
            label={t('Nové heslo')}
            hint={account ? t('Nechajte prázdne, ak sa heslo nemení.') : undefined}
          >
            <TextInput
              id="account-password"
              type="password"
              autoComplete="new-password"
              required={!account}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {(!account || password) && (
            <Field id="account-password-repeat" label={t('Potvrďte nové heslo')}>
              <TextInput
                id="account-password-repeat"
                type="password"
                autoComplete="new-password"
                required
                value={repeated}
                onChange={(event) => setRepeated(event.target.value)}
              />
            </Field>
          )}
          <Checkbox
            checked={draft.active}
            onChange={(event) => change('active', event.target.checked)}
          >
            {t('Aktívny účet')}
          </Checkbox>
          <fieldset disabled={!options.can_manage_privileges}>
            <legend>{t('Oprávnenia')}</legend>
            <Checkbox
              checked={draft.is_staff}
              onChange={(event) => change('is_staff', event.target.checked)}
            >
              {t('Prístup do administrácie')}
            </Checkbox>
            <Checkbox
              checked={draft.is_superuser}
              onChange={(event) => change('is_superuser', event.target.checked)}
            >
              {t('Superuser')}
            </Checkbox>
            <h3>{t('Skupiny')}</h3>
            {options.groups.map((group) => (
              <Checkbox
                key={group.id}
                checked={draft.group_ids.includes(group.id)}
                onChange={(event) => toggle('group_ids', group.id, event.target.checked)}
              >
                {group.name}
              </Checkbox>
            ))}
            <h3>{t('Priame oprávnenia')}</h3>
            {options.permissions.map((permission) => (
              <Checkbox
                key={permission.id}
                checked={draft.permission_ids.includes(permission.id)}
                onChange={(event) => toggle('permission_ids', permission.id, event.target.checked)}
              >
                {permission.app_label}.{permission.codename} — {permission.name}
              </Checkbox>
            ))}
          </fieldset>
          {editable && (
            <Button type="submit" disabled={busy}>
              {busy ? t('Spracúvam…') : t('Uložiť účet')}
            </Button>
          )}
        </fieldset>
        {account &&
          options.can_delete &&
          (confirming ? (
            <div>
              <Notice>{t('Naozaj vymazať tento účet?')}</Notice>
              <Button type="button" disabled={busy} onClick={() => void remove()}>
                {t('Potvrdiť vymazanie')}
              </Button>{' '}
              <Button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                {t('Zrušiť')}
              </Button>
            </div>
          ) : (
            <Button type="button" disabled={busy} onClick={() => setConfirming(true)}>
              {t('Vymazať účet')}
            </Button>
          ))}
        {account && (
          <p className="hint">
            {t('Dátum vytvorenia')}: {account.date_joined}
            <br />
            {t('Posledné prihlásenie')}: {account.last_login ?? '—'}
          </p>
        )}
        {error && <Notice tone="err">{error}</Notice>}
      </form>
    </Panel>
  );
}
