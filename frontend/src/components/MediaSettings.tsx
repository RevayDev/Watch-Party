import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '../shared/components/BottomSheet';

function DeviceTest({ kind, localStream }: { kind: 'audio' | 'video'; localStream: MediaStream | null }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const preview = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLMeterElement>(null);
  const request = useRef(0);
  const ownedStream = useRef<MediaStream | null>(null);
  const microphone = kind === 'audio';
  const label = microphone ? 'micrófono' : 'cámara';

  useEffect(() => () => {
    request.current += 1;
    ownedStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!stream) return;
    const track = stream.getTracks()[0];
    const onEnded = () => {
      setStream(null);
      setError(`Se perdió el acceso a ${microphone ? 'tu micrófono' : 'tu cámara'}.`);
    };
    track.addEventListener('ended', onEnded);
    const video = preview.current;
    if (video) video.srcObject = stream;
    let context: AudioContext | undefined;
    let frame = 0;
    let active = true;
    if (microphone) {
      try {
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const measure = () => {
          if (!active) return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((energy, sample) => energy + sample * sample, 0) / samples.length);
          if (meter.current) meter.current.value = Math.min(1, rms * 5);
          frame = requestAnimationFrame(measure);
        };
        void context.resume().then(measure).catch(() => {
          if (active) setError('El navegador no pudo iniciar el medidor del micrófono.');
        });
      } catch {
        setError('El navegador no pudo medir el nivel del micrófono.');
      }
    }
    return () => {
      active = false;
      track.removeEventListener('ended', onEnded);
      if (video) video.srcObject = null;
      cancelAnimationFrame(frame);
      if (context) void context.close().catch(() => {});
    };
  }, [microphone, stream]);

  async function toggleTest() {
    setError('');
    if (stream) {
      ownedStream.current?.getTracks().forEach((track) => track.stop());
      ownedStream.current = null;
      setStream(null);
      return;
    }

    const id = ++request.current;
    setPending(true);
    try {
      const track = localStream?.getTracks().find((candidate) =>
        candidate.kind === kind && candidate.readyState === 'live' && candidate.enabled);
      const testStream = track
        ? new MediaStream([track.clone()])
        : await navigator.mediaDevices.getUserMedia({ [kind]: true });
      if (id !== request.current) {
        testStream.getTracks().forEach((candidate) => candidate.stop());
        return;
      }
      if (testStream.getTracks().every((candidate) => candidate.readyState !== 'live')) {
        testStream.getTracks().forEach((candidate) => candidate.stop());
        throw new DOMException('Sin pista activa', 'NotFoundError');
      }
      ownedStream.current = testStream;
      setStream(testStream);
    } catch (err) {
      if (id === request.current) {
        setError(err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Permite el acceso al dispositivo en la configuración de tu navegador.'
          : 'No se pudo abrir el dispositivo. Comprueba que esté conectado y disponible.');
      }
    } finally {
      if (id === request.current) setPending(false);
    }
  }

  return (
    <section className="room-settings__box" aria-label={`Prueba de ${label}`}>
      <button type="button" className="btn btn--primary" onClick={() => void toggleTest()} disabled={pending}>
        {pending ? 'Esperando permiso…' : stream ? `Detener prueba de ${label}` : `Probar ${label}`}
      </button>
      {error && <p role="alert">{error}</p>}
      {stream && (microphone ? (
        <>
          <p className="room-settings__box-desc">Habla y comprueba que se mueva el medidor.</p>
          <meter ref={meter} className="media-settings__level" min={0} max={1} value={0} aria-label="Nivel del micrófono" />
        </>
      ) : (
        <video ref={preview} className="media-settings__preview" autoPlay muted playsInline aria-label="Vista previa de tu cámara" />
      ))}
    </section>
  );
}

export function MediaSettings({ localStream, onClose, onRetry }: {
  localStream: MediaStream | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <BottomSheet open onClose={onClose} label="Micrófono y cámara" className="modal-card--settings">
      <div className="modal-card__header">
        <h3 className="leader-exit-modal__title">Micrófono y cámara</h3>
      </div>
      <p className="room-settings__box-desc">Las pruebas son locales y no cambian lo que compartes en la sala.</p>
      <div className="media-settings__tests">
        <DeviceTest kind="audio" localStream={localStream} />
        <DeviceTest kind="video" localStream={localStream} />
      </div>
      <div className="room-settings__actions">
        <button type="button" className="leader-exit-modal__cancel-btn" onClick={onRetry}>Reconectar audio y cámara</button>
        <button type="button" className="btn btn--primary" onClick={onClose}>Cerrar</button>
      </div>
    </BottomSheet>
  );
}
