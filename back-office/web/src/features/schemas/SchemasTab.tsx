// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listSchemas } from '../../shared/api/schemas.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import CodeText from '../../shared/ui/CodeText.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import Table from '../../shared/ui/Table.tsx';
import { formatDateTime as when, t } from '../../shared/i18n/index.ts';
import { fieldLabel, inLang, learnLabels } from '../../shared/certificates/fields.ts';

/**
 * The localized field kinds.
 * @returns Labels by kind.
 */
function kindLabels() {
  return { text: t('Text'), date: t('Dátum'), integer: t('Celé číslo') };
}

/**
 * Render a schema's attributes as its registry document gives them.
 * @param options - Component inputs: {fields}.
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
            <td>{field.required ? t('áno') : t('nie')}</td>
            <td className="muted">{field.default || '—'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Certificate schemas: the ones this installation takes from EBSI's Trusted Schemas Registry.
 *
 * Nobody defines a schema here: on EBSI the Support Office registers it, and the installation
 * names the registry ids it uses. A TAO is accredited for some of them (Akreditácia) and hands
 * them on to its TIs, who issue only those. Everyone here only reads.
 * @returns The rendered React content.
 */
export default function SchemasTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');

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

  return (
    <Panel
      hint={t(
        'Druhy certifikátov z registra schém EBSI (TSR). Schémy v ňom registruje Support Office EBSI; táto inštalácia používa tie, ktoré má nastavené. TAO ich v Akreditácii prideľuje TI a TI vydáva len tie, ktoré dostala.',
      )}
      title={t('Certifikačné schémy')}
    >
      {error && <Notice tone="err">{error}</Notice>}
      {data && !data.schemas.length && (
        <Notice tone="warn">{t('Inštalácia zatiaľ nepoužíva žiadnu schému z TSR.')}</Notice>
      )}
      {data && data.schemas.length > 0 && (
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
                    {schema.retired_at ? (
                      <Badge tone="expired">{t('vyradená')}</Badge>
                    ) : (
                      <Badge tone="approved">{t('v TSR')}</Badge>
                    )}
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
                    </Button>
                  </td>
                </tr>
                {open === schema.credential_type && (
                  <tr>
                    <td colSpan={5}>
                      <Fields fields={schema.versions[0]?.fields ?? []} />
                      <div className="footnote">
                        {schema.versions.map((version) => (
                          <div key={version.version}>
                            {t('Verzia {0}', [version.version])}: {t('načítaná')}{' '}
                            {when(version.registered_at)} —{' '}
                            <span className="mono">{version.schema_address}</span>
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
      {data?.schemas.some((schema) => schema.retired_at) && (
        <div className="footnote">
          {t(
            'Vyradená schéma už nie je nastavená: nové certifikáty podľa nej vydať nemožno, doteraz vydané zostávajú platné.',
          )}
        </div>
      )}
    </Panel>
  );
}
