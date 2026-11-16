// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatDateTime, t } from '../i18n/index.ts';
import CodeText from './CodeText.tsx';
import Field from './Field.tsx';
import Panel from './Panel.tsx';

/**
 * A credential offer for the holder: the QR, and the PIN they are told apart.
 *
 * The QR alone collects nothing. The token endpoint asks for the PIN (the
 * EBSI v3 pre-authorised flow's user_pin), a few wrong guesses void the offer,
 * and it expires - so a photographed QR is useless. That only works if the
 * PIN does not travel with the QR: say it, or send it another way.
 * @param options - Existing component inputs: {offer, title = t("Odovzdanie do peňaženky")}.
 * @returns The rendered React content.
 */
export default function OfferPanel(options) {
  const { offer, title = t('Odovzdanie do peňaženky') } = options;

  const [qr, setQr] = useState('');

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(offer.offer_uri, { width: 320, margin: 1 }).then((url) => alive && setQr(url));
    return () => {
      alive = false;
    };
  }, [offer.offer_uri]);

  const expires = offer.offer_expires_at ? new Date(offer.offer_expires_at) : null;
  const hint = (
    <>
      {t('Ponuka platí pre tento jeden certifikát a dá sa uplatniť raz.')}
      {expires && (
        <>
          {' '}
          {t('Platí do')} <b>{formatDateTime(expires)}</b>.
        </>
      )}
    </>
  );

  return (
    <Panel title={title} hint={hint}>
      <div className="row offer-layout">
        {qr && (
          <img
            className="offer-qr"
            src={qr}
            alt={t('QR kód s ponukou certifikátu')}
            width={320}
            height={320}
          />
        )}
        {offer.pin && (
          <Field label={t('PIN pre držiteľa')}>
            <CodeText className="offer-pin">{offer.pin}</CodeText>
            <p className="footnote offer-note">
              {t(
                'Povedzte ho držiteľovi alebo mu ho pošlite iným kanálom než QR kód. Peňaženka si ho vypýta po naskenovaní. Zobrazí sa len teraz — back-office si ho neuchováva; po piatich zlých pokusoch ponuka prepadne.',
              )}
            </p>
          </Field>
        )}
      </div>
    </Panel>
  );
}
