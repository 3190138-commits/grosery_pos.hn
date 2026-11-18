import React, { useState } from 'react';
import { Printer, Download, Send, X, Check } from 'lucide-react';
import type { Invoice } from '../types';
import { downloadInvoicePDF, formatCurrency } from '../lib/api';

interface InvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
  defaultThermal?: boolean;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoice, onClose, defaultThermal = false }) => {
  const [formatMode, setFormatMode] = useState<'carta' | 'termica'>(defaultThermal ? 'termica' : 'carta');
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDigitalSend = () => {
    const summary = `Comprobante ${invoice.invoice_number} — Los Patrones Mini Market\nTotal: ${formatCurrency(invoice.total)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(summary).catch(() => {});
    }
    setSentNotice('Resumen del comprobante copiado y listo para compartir por WhatsApp / correo.');
    setTimeout(() => setSentNotice(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/55 p-4 overflow-y-auto">
      <div className="bg-white border border-[#202633]/12 rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#202633]/12 no-print">
          <div>
            <h3 className="text-xl text-[#202633] font-display">
              Comprobante de Venta · {invoice.invoice_number}
            </h3>
            <p className="text-xs text-[#202633]/65 mt-0.5">
              {invoice.status === 'anulada'
                ? `Anulado (${invoice.credit_note_number})`
                : 'Emitido por Los Patrones Mini Market'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#FFF4E5] p-1 rounded-lg border border-[#202633]/10">
              <button
                type="button"
                onClick={() => setFormatMode('carta')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  formatMode === 'carta' ? 'bg-white text-[#202633] shadow-xs' : 'text-[#202633]/65 hover:text-[#202633]'
                }`}
              >
                Formato Carta
              </button>
              <button
                type="button"
                onClick={() => setFormatMode('termica')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  formatMode === 'termica' ? 'bg-white text-[#202633] shadow-xs' : 'text-[#202633]/65 hover:text-[#202633]'
                }`}
              >
                Térmica 80mm
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-[#202633]/55 hover:text-[#202633] rounded-lg hover:bg-[#FFF4E5]"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto bg-[#FFF4E5]/60 flex justify-center">
          <div
            className={`bg-white border border-[#202633]/15 text-[#202633] ${
              formatMode === 'termica' ? 'w-[320px] p-4 font-mono text-xs' : 'w-full p-8 text-sm'
            }`}
          >
            {invoice.status === 'anulada' && (
              <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-800 text-xs font-medium text-center">
                FACTURA ANULADA · NOTA DE CRÉDITO {invoice.credit_note_number} · Motivo: {invoice.void_reason}
              </div>
            )}

            <div className={formatMode === 'termica' ? 'text-center space-y-1 pb-3 border-b border-dashed border-[#202633]/25' : 'flex justify-between items-start pb-6 border-b border-[#202633]/15'}>
              <div className={formatMode === 'termica' ? 'flex flex-col items-center gap-1' : 'flex items-start gap-3'}>
                <img
                  src="/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png"
                  alt="Los Patrones Mini Market"
                  className={formatMode === 'termica' ? 'w-10 h-10 rounded-lg object-cover' : 'w-11 h-11 rounded-lg object-cover shrink-0'}
                />
                <div>
                  <h4 className="font-display text-xl tracking-wide text-[#202633]">LOS PATRONES MINI MARKET</h4>
                  <p className="text-xs text-[#202633]/70">{invoice.emitter_name || 'Los Patrones Mini Market'}</p>
                  <p className="text-xs text-[#202633]/70 max-w-xs">{invoice.emitter_address}</p>
                </div>
              </div>
              <div className={formatMode === 'termica' ? 'pt-2' : 'text-right'}>
                <p className="font-semibold text-[#202633] font-mono">Comprobante N.º {invoice.invoice_number}</p>
                <p className="text-xs text-[#202633]/60 font-mono">{invoice.issued_at}</p>
              </div>
            </div>

            <div className="py-4 border-b border-[#202633]/15 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[#202633]/60">Cliente: </span>
                <span className="font-semibold text-[#202633]">{invoice.customer_name}</span>
              </div>
              <div>
                <span className="text-[#202633]/60">Fecha: </span>
                <span className="font-mono text-[#202633]">{invoice.issued_at}</span>
              </div>
              <div>
                <span className="text-[#202633]/60">Pago: </span>
                <span className="text-[#202633]">
                  {invoice.payment_method === 'transferencia' ? 'Transferencia bancaria' : 'Efectivo'}
                </span>
              </div>
            </div>

            <table className="w-full text-left border-collapse my-4 text-xs">
              <thead>
                <tr className="border-b border-[#202633]/15 text-[#202633]/65">
                  <th className="py-2 font-semibold">Producto</th>
                  <th className="py-2 font-semibold text-right">Cant.</th>
                  <th className="py-2 font-semibold text-right">Precio</th>
                  <th className="py-2 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.items || []).map((item) => (
                  <tr key={item.id} className="border-b border-[#202633]/8">
                    <td className="py-2 pr-2">
                      <div className="font-medium text-[#202633]">{item.product_name}</div>
                      <div className="text-[11px] text-[#202633]/60 font-mono">
                        {item.internal_code}
                      </div>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{item.quantity}</td>
                    <td className="py-2 text-right font-sans tabular-nums">{formatCurrency(item.unit_price)}</td>
                    <td className="py-2 text-right font-sans tabular-nums font-semibold">{formatCurrency(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col items-end space-y-1 text-xs pt-2 border-t border-[#202633]/15">
              {invoice.discount_total > 0 && (
                <div className="flex justify-between w-56 text-[#0A7830] font-semibold">
                  <span>Descuentos:</span>
                  <span className="font-sans tabular-nums">-{formatCurrency(invoice.discount_total)}</span>
                </div>
              )}
              {invoice.delivery_fee > 0 && (
                <div className="flex justify-between w-56">
                  <span className="text-[#202633]/70">Envío a domicilio:</span>
                  <span className="font-sans tabular-nums">{formatCurrency(invoice.delivery_fee)}</span>
                </div>
              )}
              <div className="flex justify-between w-56 pt-2 border-t border-[#202633]/25 text-sm font-bold text-[#202633]">
                <span>Total a Pagar:</span>
                <span className="font-sans tabular-nums">{formatCurrency(invoice.total)}</span>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-[#202633]/15 text-[11px] text-[#202633]/70 space-y-1">
              <p className="font-semibold text-[#202633]">Son: {invoice.amount_in_words}</p>
              <p>Gracias por su preferencia en Los Patrones Mini Market.</p>
            </div>
          </div>
        </div>

        {sentNotice && (
          <div className="px-6 py-2.5 bg-[#13B64B]/12 border-t border-[#13B64B]/40 text-xs text-[#0A7830] font-medium flex items-center gap-2 no-print">
            <Check className="w-4 h-4 shrink-0" />
            <span>{sentNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-4 border-t border-[#202633]/12 bg-white no-print">
          <button
            type="button"
            onClick={handleDigitalSend}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#202633] bg-[#FFF4E5] hover:bg-[#F9D94A]/40 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Enviar digitalmente
          </button>
          <button
            type="button"
            onClick={() => downloadInvoicePDF(invoice)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#202633] bg-[#FFF4E5] hover:bg-[#F9D94A]/40 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar PDF
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir Comprobante
          </button>
        </div>
      </div>
    </div>
  );
};
