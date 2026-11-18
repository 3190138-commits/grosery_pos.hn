import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X, AlertCircle } from 'lucide-react';

interface CameraBarcodeModalProps {
  preferredFacing?: 'environment' | 'user';
  title?: string;
  onDetected: (code: string) => void;
  onClose: () => void;
}

export const CameraBarcodeModal: React.FC<CameraBarcodeModalProps> = ({
  preferredFacing = 'environment',
  title = 'Escanear código de barras con cámara',
  onDetected,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    async function startScanner() {
      setErrorMsg('');
      try {
        const videoDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;
        setDevices(videoDevices);

        let chosenId = selectedDeviceId;
        if (!chosenId && videoDevices.length > 0) {
          const preferred = videoDevices.find((d) =>
            preferredFacing === 'environment'
              ? /back|rear|environment|trasera/i.test(d.label)
              : /front|user|frontal/i.test(d.label)
          );
          chosenId = preferred?.deviceId || videoDevices[0].deviceId;
          setSelectedDeviceId(chosenId);
        }

        if (!videoRef.current) return;

        const controls = await reader.decodeFromVideoDevice(
          chosenId || undefined,
          videoRef.current,
          (result, _err) => {
            if (result && active) {
              const text = result.getText().trim();
              if (text) {
                setActive(false);
                controls?.stop();
                onDetected(text);
              }
            }
          }
        );
        if (cancelled) {
          controls.stop();
        } else {
          controlsRef.current = controls;
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(
            err?.name === 'NotAllowedError'
              ? 'Permiso de cámara denegado. Habilita el acceso a la cámara o ingresa el código manualmente.'
              : 'No se detectó cámara disponible en este equipo. Puedes conectar un lector USB o ingresar el código manualmente.'
          );
        }
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [selectedDeviceId, preferredFacing]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    controlsRef.current?.stop();
    onDetected(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/60 p-4">
      <div className="bg-white border border-[#202633]/12 rounded-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-[#202633]/12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-[#2054C9]" />
            <h3 className="text-lg text-[#202633] font-display">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              controlsRef.current?.stop();
              onClose();
            }}
            className="p-1.5 text-[#202633]/50 hover:text-[#202633] rounded-lg"
            aria-label="Cerrar escáner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {devices.length > 1 && (
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
            >
              {devices.map((d, idx) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Cámara ${idx + 1}`}
                </option>
              ))}
            </select>
          )}

          {errorMsg ? (
            <div className="p-4 bg-[#FFF4E5] border border-[#F9D94A] rounded-xl text-xs text-[#202633] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#202633]" />
              <span>{errorMsg}</span>
            </div>
          ) : (
            <div className="relative aspect-[4/3] bg-[#202633] rounded-xl overflow-hidden border border-[#202633]/20">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-28 border-2 border-[#13B64B] rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/90 font-medium">
                Enfoca el código de barras dentro del recuadro
              </p>
            </div>
          )}

          <form onSubmit={handleManualSubmit} className="pt-2 border-t border-[#202633]/10 space-y-2">
            <label className="block text-xs font-medium text-[#202633]/75">
              Ingreso manual alternativo
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Ej. 7401001100011 o LP-001"
                className="flex-1 px-3 py-2 text-xs font-mono border border-[#202633]/20 rounded-lg"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
              >
                Usar código
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
