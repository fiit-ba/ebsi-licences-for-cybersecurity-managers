// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { presentationExchange, presentationResult } from '../../shared/api/verification.ts';
import Button from '../../shared/ui/Button.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import { t } from '../../shared/i18n/index.ts';

const POLL_MS = 2000;

/**
 * What the exchange is doing, as the Verifier Service reports it (design decisions D35).
 * @param status - Existing HTTP or holder-exchange status.
 * @returns The existing holder-exchange progress explanation.
 */
function progressText(status) {
  return {
    connecting: t('Pripája sa k peňaženke držiteľa…'),
    pending: t('Peňaženka dostala žiadosť. Čaká sa, kým ju držiteľ potvrdí PIN-om…'),
  }[status];
}

/**
 * Resolve the completed holder-exchange state to its existing localized explanation.
 * @param status - Existing HTTP or holder-exchange status.
 * @returns The existing exchange completion explanation.
 */
function endText(status) {
  return {
    declined: t('Držiteľ žiadosť v peňaženke odmietol.'),
    expired: t('Výmena v peňaženke skončila. Nech držiteľ ukáže nový QR kód.'),
    unreachable: t('Peňaženka držiteľa prestala odpovedať. Je telefón stále v tej istej Wi-Fi?'),
    failed: t('Odpoveď peňaženky sa nepodarilo prečítať.'),
  }[status];
}

/**
 * The text of the QR code in an image, or '' when there is none.
 * @param source - Image or camera pixels.
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns The decoded QR text, or an empty value when no supported QR is found.
 */
function decode(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return jsQR(data, width, height)?.data ?? '';
}

/**
 * The holder shows a QR code, and the console connects to the wallet behind it.
 *
 * The other way round from the request above: the holder's wallet runs the
 * exchange on its phone, after the W3C VC-API, and the Verifier Service asks
 * it for the certificate (D33, D35). The code is scanned with the camera,
 * read from a photo of it, or pasted. The service must reach the phone, so it
 * is on the holder's Wi-Fi. The outcome is the same as for any presentation.
 * @param options - Existing component inputs: {children, onStart, onResult}.
 * @returns The rendered React content.
 */
export default function ScanHolder(options) {
  const { children, onStart, onResult } = options;

  const [text, setText] = useState('');
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const video = useRef(null);
  const picker = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);
  const run = useRef(0);

  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCamera(false);
  };

  useEffect(
    () => () => {
      run.current += 1;
      clearTimeout(timer.current);
      stopCamera();
    },
    [],
  );

  /**
   * Start the holder-initiated presentation exchange and poll its verification result.
   * @param invitation - One-time organization invitation or holder-exchange invitation expected by the selected endpoint.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function connect(invitation) {
    clearTimeout(timer.current);
    const current = run.current + 1;
    run.current = current;
    const live = () => current === run.current;
    setError('');
    setPhase('connecting');
    onStart?.();
    let state;
    try {
      ({ state } = await presentationExchange(invitation.trim()));
    } catch (e) {
      if (live()) {
        setError(e.message);
        setPhase('idle');
      }
      return;
    }
    const poll = async () => {
      if (!live()) return;
      try {
        const outcome = await presentationResult(state);
        if (!live()) return;
        if (outcome.status === 'done') {
          setPhase('idle');
          onResult(outcome);
        } else if (outcome.status === 'pending') {
          setPhase('pending');
          timer.current = setTimeout(poll, POLL_MS);
        } else {
          setPhase(outcome.status);
        }
      } catch (e) {
        if (live()) {
          setError(e.message);
          setPhase('idle');
        }
      }
    };
    setPhase('pending');
    timer.current = setTimeout(poll, POLL_MS);
  }

  /**
   * Forward decoded QR content into the existing holder-exchange connection path.
   * @param value - Current input or state value.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function found(value) {
    setText(value);
    connect(value);
  }

  /**
   * Read successive camera frames until an exchange invitation is decoded or scanning stops.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function scan() {
    setError('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
    } catch {
      setError(t('Kamera nie je dostupná. Nahrajte fotografiu QR kódu alebo vložte jeho obsah.'));
      return;
    }
    setCamera(true);
  }

  // Frames from the camera until one holds a QR code.
  useEffect(() => {
    if (!camera || !video.current) return undefined;
    let frame;
    const element = video.current;
    element.srcObject = stream.current;
    element.play().catch(() => {});
    const look = () => {
      if (element.videoWidth) {
        const value = decode(element, element.videoWidth, element.videoHeight);
        if (value) {
          stopCamera();
          found(value);
          return;
        }
      }
      frame = requestAnimationFrame(look);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [camera]);

  /**
   * Decode an uploaded image and forward its QR invitation into the holder exchange.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns Completion after the decoded invitation is forwarded or the error is shown.
   */
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // Decoded straight from the file: an <img> from a blob: URL is refused by the
    // console's Content-Security-Policy (img-src 'self' data:).
    let image;
    try {
      image = await createImageBitmap(file);
    } catch {
      setError(t('Obrázok sa nepodarilo načítať.'));
      return;
    }
    const value = decode(image, image.width, image.height);
    image.close();
    if (value) found(value);
    else setError(t('Na obrázku sa nenašiel QR kód.'));
  }

  const busy = phase === 'connecting' || phase === 'pending';
  const cameraAvailable =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  return (
    <Panel
      title={t('Overiť z telefónu držiteľa')}
      hint={t(
        'Držiteľ v peňaženke stlačí „Preukázať sa overovateľovi“ a ukáže QR kód. Overovacia služba sa spojí priamo s peňaženkou na jeho telefóne, požiada o certifikát a overí ho v registroch EBSI a v kontrakte riadenia. Telefón musí byť v sieti, na ktorú služba dosiahne – v rovnakej Wi-Fi.',
      )}
    >
      <FormActions>
        {cameraAvailable && !camera && (
          <Button disabled={busy} onClick={scan}>
            {t('Skenovať kamerou')}
          </Button>
        )}
        {camera && (
          <Button variant="ghost" onClick={stopCamera}>
            {t('Zastaviť kameru')}
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => picker.current?.click()}>
          {t('Nahrať obrázok QR kódu')}
        </Button>
        <input ref={picker} type="file" accept="image/*" hidden onChange={upload} />
      </FormActions>

      {camera && <video ref={video} className="qr-camera" muted playsInline />}

      <Field className="holder-invitation-field" id="holder-invitation" label={t('Obsah QR kódu')}>
        <textarea
          id="holder-invitation"
          value={text}
          placeholder='{"type":"PlrPresentationExchange", …}'
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <FormActions>
        <Button disabled={busy || !text.trim()} onClick={() => connect(text)}>
          {busy ? t('Overuje sa…') : t('Pripojiť sa k peňaženke')}
        </Button>
      </FormActions>

      {error && <Notice tone="err">{error}</Notice>}
      {progressText(phase) && <Notice>{progressText(phase)}</Notice>}
      {endText(phase) && <Notice tone="warn">{endText(phase)}</Notice>}
      {children}
    </Panel>
  );
}
