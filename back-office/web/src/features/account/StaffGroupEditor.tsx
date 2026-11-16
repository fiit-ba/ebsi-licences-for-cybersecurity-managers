import { useState } from 'react';
import type { FormEvent } from 'react';
import type { StaffGroup, StaffGroupOptions } from '../../../../shared/staff-groups.ts';
import { saveStaffGroup, deleteStaffGroup } from '../../shared/api/staffGroups.ts';
import { t } from '../../shared/i18n/index.ts';
import Field from '../../shared/ui/Field.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import Checkbox from '../../shared/ui/Checkbox.tsx';
import Button from '../../shared/ui/Button.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';

/** Current group authority, optional row and committed-operation callbacks. */
interface GroupEditorProps {
  options: StaffGroupOptions;
  group?: StaffGroup;
  onSaved: (group: StaffGroup) => void;
  onDeleted: () => void;
  confirmDeletion?: boolean;
}

/**
 * Render the existing group name, permission selection and deletion workflow.
 * @param props - Live group authority, versioned row and navigation callbacks.
 * @returns Group editing controls; server checks remain authoritative.
 */
export default function StaffGroupEditor(props: GroupEditorProps) {
  const { options, group, onSaved, onDeleted } = props;
  const [name, setName] = useState(group?.name ?? '');
  const [permissions, setPermissions] = useState(group?.permission_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(props.confirmDeletion ?? false);
  const editable = group ? options.can_change : options.can_add;

  /**
   * Submit a complete versioned group edit, preserving hidden existing grants.
   * @param event - Native form submission.
   * @returns Completion after a committed save or visible refusal.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !editable) return;
    setBusy(true);
    setError('');
    try {
      onSaved(
        await saveStaffGroup({
          name,
          permission_ids: permissions,
          ...(group ? { group_id: group.id, version: group.version } : {}),
        }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Skupinu sa nepodarilo uložiť.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Delete a displayed group only after the explicit confirmation step.
   * @returns Completion after deletion/navigation or a displayed refusal.
   */
  async function remove(): Promise<void> {
    if (!group || !options.can_delete || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteStaffGroup(group);
      onDeleted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Skupinu sa nepodarilo vymazať.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={group?.name ?? t('Nová skupina')}>
      <form onSubmit={submit}>
        <fieldset disabled={!editable || busy}>
          <Field id="group-name" label={t('Názov skupiny')}>
            <TextInput
              id="group-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <fieldset>
            <legend>{t('Oprávnenia')}</legend>
            {options.permissions.map((permission) => (
              <Checkbox
                key={permission.id}
                checked={permissions.includes(permission.id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setPermissions((current) =>
                    checked
                      ? [...current, permission.id]
                      : current.filter((id) => id !== permission.id),
                  );
                }}
              >
                {permission.app_label}.{permission.codename} — {permission.name}
              </Checkbox>
            ))}
          </fieldset>
          {editable && (
            <Button type="submit" disabled={busy}>
              {t('Uložiť skupinu')}
            </Button>
          )}
        </fieldset>
        {group &&
          options.can_delete &&
          (confirming ? (
            <div>
              <Notice>{t('Naozaj vymazať túto skupinu?')}</Notice>
              <Button type="button" disabled={busy} onClick={() => void remove()}>
                {t('Potvrdiť vymazanie')}
              </Button>{' '}
              <Button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                {t('Zrušiť')}
              </Button>
            </div>
          ) : (
            <Button type="button" disabled={busy} onClick={() => setConfirming(true)}>
              {t('Vymazať skupinu')}
            </Button>
          ))}
        {error && <Notice tone="err">{error}</Notice>}
      </form>
    </Panel>
  );
}
