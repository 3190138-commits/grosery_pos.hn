import React from 'react';
import { Printer, X } from 'lucide-react';
import type { Product } from '../types';
import { formatCurrency } from '../lib/api';

interface BarcodeLabelModalProps {
  product: Product;
  code: string;
  presentation?: string;
  price?: number;
  onClose: () => void;
}

// Deterministic visual Code-128 style bar pattern from any string
function buildBarPattern(text: string): number[] {
  const bars: number[] = [2, 1, 2, 1, 1, 2]; // start guard
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bars.push(1 + (c % 3), 1 + ((c >> 2) % 2), 1 + ((c >> 4) % 3), 1);
  }
  bars.push(2, 1, 1, 2, 2); // stop guard
  return bars;
}

export const BarcodeLabelModal: React.FC<BarcodeLabelModalProps> = ({
  product,
  code,
  presentation,
  price,
  onClose,
}) => {
  const bars = buildBarPattern(code);
  let x = 8;
  const rects: { x: number; w: number }[] = [];
  bars.forEach((width, idx) => {
    const w = width * 1.8;
    if (idx % 2 === 0) {
      rects.push({ x, w });
    }
    x += w;
  });
  const totalWidth = x + 8;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/55 p-4">
      <div className="bg-white border border-[#202633]/12 rounded-xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#202633]/12 flex items-center justify-between no-print">
          <h3 className="text-lg text-[#202633] font-display">Etiqueta de código interno</h3>
          <button type="button" onClick={onClose} className="p-1 text-[#202633]/50 hover:text-[#202633]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex justify-center bg-[#FFF4E5]/60">
          <div className="bg-white border border-[#202633]/20 rounded-lg p-4 w-64 text-center space-y-1.5">
            <p className="text-sm text-[#202633] font-display tracking-wider">LOS PATRONES MINI MARKET</p>
            <p className="text-xs font-bold text-[#202633] line-clamp-1">{product.name}</p>
            <p className="text-[11px] text-[#202633]/70">{presentation || product.presentation}</p>
            <div className="flex justify-center py-1">
              <svg viewBox={`0 0 ${totalWidth} 52`} className="w-full max-w-[200px] h-12" aria-label={`Código ${code}`}>
                {rects.map((r, idx) => (
                  <rect key={idx} x={r.x} y={2} width={r.w} height={46} fill="#202633" />
                ))}
              </svg>
            </div>
            <p className="font-mono text-xs font-semibold tracking-widest text-[#202633]">{code}</p>
            <p className="font-sans text-base font-bold text-[#2054C9] tabular-nums">
              {formatCurrency(price ?? product.promo_price ?? product.sale_price)}
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#202633]/12 flex justify-end gap-2 no-print">
          <button type="button" onClick={onClose} className="px-3.5 py-2 text-xs font-medium bg-[#FFF4E5] text-[#202633] rounded-lg">
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir etiqueta
          </button>
        </div>
      </div>
    </div>
  );
};
