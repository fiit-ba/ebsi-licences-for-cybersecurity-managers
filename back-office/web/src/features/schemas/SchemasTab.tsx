// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  confirmSchema,
  listSchemas,
  proposeSchema,
  retireSchema,
} from '../../shared/api/schemas.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import Checkbox from '../../shared/ui/Checkbox.tsx';
import CheckboxGroup from '../../shared/ui/CheckboxGroup.tsx';
import CodeText from '../../shared/ui/CodeText.tsx';
import ConfirmDialog from '../../shared/ui/ConfirmDialog.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import SelectField from '../../shared/ui/SelectField.tsx';
import Table from '../../shared/ui/Table.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import { cx as cx } from '../../shared/ui/classes.ts';
import { formatDateTime as when, t } from '../../shared/i18n/index.ts';
import { SECTIONS, fieldLabel, inLang, learnLabels } from '../../shared/certificates/fields.ts';

/**
 * Certificate schemas (design decisions D17).
 *
 * The RootTAO says what kinds of certificate exist and what each says. A TAO
 * is then accredited for some of them (Akreditácia) and hands them on to its
 * TIs, who issue only those. A version counts once the Trusted Schemas
 * Registry serves it: against the development mock that is immediate, against
 * EBSI the Support Office registers it and the RootTAO records the identifier
 * it got. A change is always a new version, so every certificate keeps the
 * schema it was issued under. Everyone else here only reads.
 * @returns The localized field-kind catalog.
 */
function kindLabels() {
  return { text: t('Text'), date: t('Dátum'), integer: t('Celé číslo') };
}

/**
 * Build localized explanations for the existing schema-validation refusal codes.
 * @returns The localized schema refusal catalog.
 */
function schemaMessages() {
  return {
    TypeInvalid: t(
      'Typ certifikátu musí začínať veľkým písmenom a obsahovať len písmená a číslice, napr. DataProtectionOfficerCertificate.',
    ),
    TypeReserved: t('Tento typ je vyhradený pre EBSI.'),
    NameMissing: t('Zadajte slovenský názov schémy.'),
    NoFields: t('Schéma potrebuje aspoň jeden atribút.'),
    TooManyFields: t('Schéma môže mať najviac 40 atribútov.'),
    FieldInvalid: t('Atribút {0} je neplatný.'),
    KeyInvalid: t(
      'Kľúč atribútu {0} musí začínať malým písmenom a obsahovať len písmená a číslice, napr. holderName.',
    ),
    KeyReserved: t('Kľúč „{1}“ je vyhradený.'),
    KeyDuplicate: t('Kľúč „{1}“ je použitý dvakrát.'),
    KindInvalid: t('Atribút „{1}“ má neznámy typ.'),
    KindChanged: t(
      'Atribút „{1}“ mal v predchádzajúcej verzii iný typ. Typ sa meniť nemôže: certifikáty vydané skôr by schéme prestali zodpovedať.',
    ),
    SectionInvalid: t('Atribút „{1}“ má neznámu sekciu.'),
    LabelMissing: t('Atribút {0} potrebuje slovenský názov.'),
    DefaultInvalid: t('Predvolená hodnota atribútu „{1}“ nezodpovedá jeho typu.'),
    OrganizationNotText: t('Názov vydavateľa môže byť len textový atribút.'),
    OrganizationTwice: t('Názov vydavateľa môže vypĺňať len jeden atribút.'),
    SchemaRetired: t('Schéma je vyradená; nová verzia sa už nedá pridať.'),
    RegistrationFailed: t('Registrácia v TSR zlyhala. Návrh je uložený, skúste ho uložiť znova.'),
    NotInTsr: t('TSR schému s týmto identifikátorom neposkytuje.'),
    TsrIdInvalid: t('Identifikátor v TSR nie je platný.'),
    AlreadyRegistered: t('Táto verzia už je zaregistrovaná.'),
    NotRootTao: t('Schémy určuje len RootTAO.'),
  };
}

/**
 * Resolve a schema-validation code to its existing localized explanation.
 * @param code - Existing role, language or refusal code selected by the caller.
 * @returns The localized schema refusal or its unknown code.
 */
function schemaMessage(code) {
  return schemaMessages()[code];
}

/**
 * Format the existing schema refusal and affected fields for the operator.
 * @param error - Caught failure from the existing backend, browser or contract operation.
 * @returns The readable refusal and affected-field detail.
 */
function problem(error) {
  const template = schemaMessage(error.code);
  if (!template) return error.code;
  return template
    .replace('{0}', error.index === null ? '' : String(error.index + 1))
    .replace('{1}', error.key || '');
}

const blankField = () => ({
  key: '',
  kind: 'text',
  section: 'certificate',
  required: true,
  default: '',
  organization: false,
  label: { sk: '', en: '' },
  hint: { sk: '', en: '' },
});

/**
 * Render the schema draft, published or retired state.
 * @param options - Existing component inputs: {schema}.
 * @returns The rendered React content.
 */
function State(options) {
  const { schema } = options;

  if (schema.retired_at) return <Badge tone="expired">{t('vyradená')}</Badge>;
  if (schema.pending_version)
    return (
      <Badge tone="pending">
        {t('verzia {0} čaká na registráciu v TSR', [schema.pending_version])}
      </Badge>
    );
  return <Badge tone="approved">{t('zaregistrovaná v TSR')}</Badge>;
}

/**
 * Render the existing schema fields with their labels, kinds and requirements.
 * @param options - Existing component inputs: {fields}.
 * @returns The rendered React content.
 */
function Fields(options) {
  const { fields } = options;

  const kinds = kindLabels();
  return (
    <Table>
      <thead>
        <tr>
          <th>{t('Atribút')}</th>
          <th>{t('Kľúč')}</th>
          <th>{t('Typ')}</th>
          <th>{t('Sekcia')}</th>
          <th>{t('Povinný')}</th>
          <th>{t('Predvolená hodnota')}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.key}>
            <td>{fieldLabel(field.key, field)}</td>
            <td className="mono">{field.key}</td>
            <td>{kinds[field.kind] ?? field.kind}</td>
            <td>{SECTIONS[field.section] ? t(SECTIONS[field.section]) : field.section}</td>
            <td>{field.organization ? t('vydavateľ') : field.required ? t('áno') : t('nie')}</td>
            <td className="muted">{field.default || '—'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Render the existing RootTAO schema editor and its field definitions.
 * @param options - Existing component inputs: {schema, registersInMock, onSaved, onCancel}.
 * @returns The rendered React content.
 */
function Editor(options) {
  const { schema, registersInMock, onSaved, onCancel } = options;

  const kinds = kindLabels();
  const latest = schema?.versions?.[0];
  const [type, setType] = useState(schema?.credential_type ?? '');
  const [nameSk, setNameSk] = useState(schema?.name?.sk ?? '');
  const [nameEn, setNameEn] = useState(schema?.name?.en ?? '');
  const [fields, setFields] = useState(
    latest
      ? latest.fields.map((field) => ({
          ...blankField(),
          ...field,
          label: { ...field.label },
          hint: { ...field.hint },
        }))
      : [
          // A start every certificate needs; the labels are data, in both languages.
          {
            ...blankField(),
            key: 'holderName',
            section: 'holder',
            label: { sk: 'Meno a priezvisko s titulmi', en: 'Name with titles' },
          },
          {
            ...blankField(),
            key: 'certificateNumber',
            label: { sk: 'Číslo osvedčenia', en: 'Certificate number' },
          },
          {
            ...blankField(),
            key: 'issueDate',
            kind: 'date',
            label: { sk: 'Dátum vydania', en: 'Date of issue' },
          },
          {
            ...blankField(),
            key: 'certificationBody',
            organization: true,
            label: { sk: 'Vydavateľ osvedčenia', en: 'Issued by' },
          },
        ],
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');

  const change = (index, patch) =>
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  const move = (index, by) =>
    setFields((current) => {
      const next = [...current];
      const [field] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, field);
      return next;
    });

  /**
   * Submit the edited schema draft and retain its validation result or saved response.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    setMessage('');
    try {
      const saved = await proposeSchema({
        credential_type: type.trim(),
        name_sk: nameSk.trim(),
        name_en: nameEn.trim(),
        fields: fields.map((field) => ({ ...field, key: field.key.trim() })),
      });
      onSaved(saved);
    } catch (e) {
      if (e.reason === 'InvalidSchema') setErrors(e.payload?.errors ?? []);
      else setMessage(schemaMessage(e.reason) ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  const wrong = new Set(errors.filter((error) => error.index !== null).map((error) => error.index));

  return (
    <Panel
      as="form"
      hint={
        schema
          ? t(
              'Zmena vytvorí verziu {0}. Doteraz vydané certifikáty zostávajú pod svojou verziou; typ atribútu sa medzi verziami meniť nemôže.',
              [(latest?.version ?? 0) + 1],
            )
          : t(
              'Typ certifikátu je jeho identifikátor v každom certifikáte a v TSR; neskôr sa meniť nedá.',
            )
      }
      title={schema ? t('Nová verzia schémy {0}', [inLang(schema.name)]) : t('Nová schéma')}
      onSubmit={save}
    >
      <div className="grid">
        <Field id="sc-type" label={t('Typ certifikátu')}>
          <TextInput
            id="sc-type"
            mono
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="DataProtectionOfficerCertificate"
            disabled={Boolean(schema)}
            required
          />
        </Field>
        <Field id="sc-name-sk" label={t('Názov (slovensky)')}>
          <TextInput
            id="sc-name-sk"
            value={nameSk}
            placeholder="Manažér ochrany údajov"
            onChange={(e) => setNameSk(e.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field id="sc-name-en" label={t('Názov (anglicky)')}>
          <TextInput
            id="sc-name-en"
            value={nameEn}
            placeholder="Data Protection Officer"
            onChange={(e) => setNameEn(e.target.value)}
            maxLength={200}
          />
        </Field>
      </div>

      <h3>{t('Atribúty')}</h3>
      {fields.map((field, index) => (
        <div key={index} className={cx('schema-field', wrong.has(index) && 'wrong')}>
          <div className="schema-field-head">
            <span>{t('Atribút {0}', [index + 1])}</span>
            <FormActions>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t('Posunúť vyššie')}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => move(index, 1)}
                disabled={index === fields.length - 1}
                aria-label={t('Posunúť nižšie')}
              >
                ↓
              </Button>
              <Button
                className="danger"
                size="sm"
                variant="ghost"
                onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
              >
                {t('Odstrániť')}
              </Button>
            </FormActions>
          </div>
          <div className="grid">
            <Field id={`sf-key-${index}`} label={t('Kľúč')}>
              <TextInput
                id={`sf-key-${index}`}
                mono
                value={field.key}
                placeholder="holderName"
                onChange={(e) => change(index, { key: e.target.value })}
              />
            </Field>
            <Field id={`sf-sk-${index}`} label={t('Názov (slovensky)')}>
              <TextInput
                id={`sf-sk-${index}`}
                value={field.label.sk}
                placeholder="Evidenčné číslo"
                onChange={(e) => change(index, { label: { ...field.label, sk: e.target.value } })}
              />
            </Field>
            <Field id={`sf-en-${index}`} label={t('Názov (anglicky)')}>
              <TextInput
                id={`sf-en-${index}`}
                value={field.label.en}
                placeholder="Registration number"
                onChange={(e) => change(index, { label: { ...field.label, en: e.target.value } })}
              />
            </Field>
            <SelectField
              id={`sf-kind-${index}`}
              label={t('Typ')}
              value={field.kind}
              onChange={(e) => change(index, { kind: e.target.value })}
            >
              {Object.entries(kinds).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id={`sf-section-${index}`}
              label={t('Sekcia')}
              value={field.section}
              onChange={(e) => change(index, { section: e.target.value })}
            >
              {Object.entries(SECTIONS).map(([section, label]) => (
                <option key={section} value={section}>
                  {t(label)}
                </option>
              ))}
            </SelectField>
            <Field id={`sf-default-${index}`} label={t('Predvolená hodnota')}>
              <TextInput
                id={`sf-default-${index}`}
                value={field.default}
                disabled={field.organization}
                placeholder={
                  field.organization
                    ? t('Vypĺňa sa názvom vydávajúcej TI')
                    : field.kind === 'date'
                      ? 'RRRR-MM-DD'
                      : field.kind === 'integer'
                        ? '0'
                        : 'N/A'
                }
                onChange={(e) => change(index, { default: e.target.value })}
              />
            </Field>
            <Field id={`sf-hint-sk-${index}`} label={t('Príklad (slovensky)')}>
              <TextInput
                id={`sf-hint-sk-${index}`}
                value={field.hint.sk}
                placeholder="Ing. Jana Nováková"
                onChange={(e) => change(index, { hint: { ...field.hint, sk: e.target.value } })}
              />
            </Field>
            <Field id={`sf-hint-en-${index}`} label={t('Príklad (anglicky)')}>
              <TextInput
                id={`sf-hint-en-${index}`}
                value={field.hint.en}
                placeholder="Jane Smith, MSc"
                onChange={(e) => change(index, { hint: { ...field.hint, en: e.target.value } })}
              />
            </Field>
          </div>
          <CheckboxGroup className="mt-2">
            <Checkbox
              checked={field.required}
              disabled={field.organization}
              onChange={(e) => change(index, { required: e.target.checked })}
            >
              {t('Povinný')}
            </Checkbox>
            <Checkbox
              checked={field.organization}
              onChange={(e) =>
                change(index, { organization: e.target.checked, kind: 'text', default: '' })
              }
            >
              {t('Vypĺňa sa názvom vydávajúcej TI')}
            </Checkbox>
          </CheckboxGroup>
        </div>
      ))}
      <FormActions>
        <Button variant="ghost" onClick={() => setFields((current) => [...current, blankField()])}>
          {t('Pridať atribút')}
        </Button>
      </FormActions>

      {errors.length > 0 && (
        <Notice tone="err">
          {errors.map((error, i) => (
            <div key={i}>{problem(error)}</div>
          ))}
        </Notice>
      )}
      {message && <Notice tone="err">{message}</Notice>}

      <FormActions>
        <Button type="submit" disabled={busy}>
          {busy
            ? t('Ukladá sa…')
            : registersInMock
              ? t('Uložiť a zaregistrovať v TSR')
              : t('Uložiť návrh pre TSR')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('Zrušiť')}
        </Button>
      </FormActions>
      <p className="footnote">
        {registersInMock
          ? t(
              'Vývojové prostredie: schéma sa hneď zaregistruje v TSR mocku a akreditácie registra sa rozšíria tak, aby ju pokrývali.',
            )
          : t(
              'Schému v EBSI registruje Support Office na základe návrhu (komponent 7). Kým ju TSR neposkytuje, nedá sa podľa nej vydávať.',
            )}
      </p>
    </Panel>
  );
}

/**
 * Render confirmation of the trusted schema registry identifier for a pending version.
 * @param options - Existing component inputs: {schema, onDone}.
 * @returns The rendered React content.
 */
function Confirm(options) {
  const { schema, onDone } = options;

  const [tsrId, setTsrId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Submit the existing schema-version registration confirmation.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function confirm(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await confirmSchema(schema.credential_type, schema.pending_version, tsrId.trim()));
    } catch (e) {
      setError(schemaMessage(e.reason) ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={confirm} className="row row-end">
      <Field
        className="flex-md"
        id={`tsr-${schema.credential_type}`}
        label={t('Identifikátor, ktorý verzii {0} pridelil TSR', [schema.pending_version])}
      >
        <TextInput
          id={`tsr-${schema.credential_type}`}
          mono
          value={tsrId}
          placeholder="zPlrDataProtectionOfficerV1"
          onChange={(e) => setTsrId(e.target.value)}
          required
        />
      </Field>
      <Button size="sm" type="submit" disabled={busy || !tsrId.trim()}>
        {t('Potvrdiť registráciu')}
      </Button>
      {error && (
        <Notice className="full-row" tone="err">
          {error}
        </Notice>
      )}
    </form>
  );
}

/**
 * Render the existing schema catalog, version editing, publication and retirement actions.
 * @returns The rendered React content.
 */
export default function SchemasTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [retiring, setRetiring] = useState(null);
  const [retireBusy, setRetireBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const listed = await listSchemas();
      learnLabels(listed.schemas);
      setData(listed);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Retire the selected schema through the existing endpoint and reload the catalog.
   * @param schema - Selected certificate schema and its current version.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function retire(schema) {
    setRetireBusy(true);
    setError('');
    try {
      await retireSchema(schema.credential_type);
      setNotice(t('Schéma {0} je vyradená.', [inLang(schema.name)]));
      await load();
    } catch (e) {
      setError(schemaMessage(e.reason) ?? e.message);
    } finally {
      setRetireBusy(false);
      setRetiring(null);
    }
  }

  /**
   * Retain the saved schema selection and refresh the visible catalog.
   * @param schema - Selected certificate schema and its current version.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function saved(schema) {
    await load();
    setEditing(null);
    setOpen(schema.credential_type);
    setNotice(
      schema.pending_version
        ? t('Verzia {0} schémy {1} je uložená a čaká na registráciu v TSR.', [
            schema.pending_version,
            inLang(schema.name),
          ])
        : t(
            'Schéma {0} je zaregistrovaná v TSR, verzia {1}. Teraz ju môžete v Akreditácii prideliť TAO.',
            [inLang(schema.name), schema.current_version],
          ),
    );
  }

  if (editing !== null) {
    return (
      <Editor
        schema={editing === 'new' ? null : editing}
        registersInMock={data?.registers_in_mock}
        onSaved={saved}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <Panel
      hint={t(
        'RootTAO určuje, aké druhy certifikátov existujú a čo každý uvádza. TAO ich v Akreditácii prideľuje TI a TI vydáva len tie, ktoré dostala.',
      )}
      title={t('Certifikačné schémy')}
    >
      {error && <Notice tone="err">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {data?.can_manage && (
        <FormActions className="row-tight mb-2">
          <Button
            onClick={() => {
              setNotice('');
              setEditing('new');
            }}
          >
            {t('Nová schéma')}
          </Button>
        </FormActions>
      )}
      {data && (
        <Table scroll={false}>
          <thead>
            <tr>
              <th>{t('Schéma')}</th>
              <th>{t('Verzia')}</th>
              <th>{t('Stav')}</th>
              <th>{t('Organizácie')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.schemas.map((schema) => (
              <Fragment key={schema.credential_type}>
                <tr>
                  <td>
                    <b>{inLang(schema.name)}</b>
                    <CodeText className="muted small-muted" wrap>
                      {schema.credential_type}
                    </CodeText>
                  </td>
                  <td>{schema.current_version ?? '—'}</td>
                  <td>
                    <State schema={schema} />
                  </td>
                  <td>{schema.organizations}</td>
                  <td className="cell-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setOpen(open === schema.credential_type ? '' : schema.credential_type)
                      }
                    >
                      {open === schema.credential_type ? t('Skryť') : t('Atribúty')}
                    </Button>{' '}
                    {data.can_manage && !schema.retired_at && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setNotice('');
                            setEditing(schema);
                          }}
                        >
                          {t('Upraviť')}
                        </Button>{' '}
                        <Button
                          className="danger"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRetiring(schema)}
                        >
                          {t('Vyradiť')}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
                {open === schema.credential_type && (
                  <tr>
                    <td colSpan={5}>
                      <Fields fields={schema.versions[0]?.fields ?? []} />
                      {data.can_manage && schema.pending_version && !data.registers_in_mock && (
                        <Confirm schema={schema} onDone={saved} />
                      )}
                      <div className="footnote">
                        {schema.versions.map((version) => (
                          <div key={version.version}>
                            {t('Verzia {0}', [version.version])}:{' '}
                            {version.registered_at ? (
                              <>
                                {t('zaregistrovaná')} {when(version.registered_at)} —{' '}
                                <span className="mono">{version.schema_address}</span>
                              </>
                            ) : (
                              t('navrhnutá {0}, čaká na registráciu v TSR', [
                                when(version.proposed_at),
                              ])
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={Boolean(retiring)}
        title={retiring ? t('Vyradiť schému {0}?', [inLang(retiring.name)]) : ''}
        confirmLabel={retireBusy ? t('Vyraďuje sa…') : t('Vyradiť schému')}
        cancelLabel={t('Zrušiť')}
        busy={retireBusy}
        danger
        onCancel={() => setRetiring(null)}
        onConfirm={() => retire(retiring)}
      >
        <p>{t('Podľa tejto schémy už nebude možné vydávať nové certifikáty.')}</p>
        <p className="muted">{t('Doteraz vydané certifikáty zostanú platné.')}</p>
      </ConfirmDialog>
    </Panel>
  );
}
