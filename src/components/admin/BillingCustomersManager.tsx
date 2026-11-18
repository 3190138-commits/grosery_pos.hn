import React, { useEffect, useState } from 'react';
import { FileText, Ban, Plus, Edit3 } from 'lucide-react';
import type { BusinessSettings, Customer, Invoice } from '../../types';
import { apiFetch, formatCurrency } from '../../lib/api';
import { InvoiceModal } from '../InvoiceModal';

export const BillingCustomersManager: React.FC<{ settings: BusinessSettings }> = ({ settings }) => {
  const [subTab, setSubTab] = useState<'facturas' | 'clientes'>('facturas');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchInv, setSearchInv] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [voidingInv, setVoidingInv] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);

  const load = async () => {
    const [invRes, custRes] = await Promise.all([
      apiFetch<Invoice[]>('/api/invoices'),
      apiFetch<Customer[]>('/api/customers'),
    ]);
    setInvoices(invRes);
    setCustomers(custRes);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredInvoices = invoices.filter((i) => {
    const q = searchInv.trim().toLowerCase();
    if (!q) return true;
    return (
      i.invoice_number.toLowerCase().includes(q) ||
      i.customer_name.toLowerCase().includes(q) ||
      i.customer_rtn.toLowerCase().includes(q) ||
      i.issued_at.toLowerCase().includes(q)
    );
  });

  const handleVoidInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidingInv) return;
    await apiFetch(`/api/invoices/${voidingInv.id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: voidReason }),
    });
    setVoidingInv(null);
    setVoidReason('');
    load();
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    if (editingCustomer.id) {
      await apiFetch(`/api/customers/${editingCustomer.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingCustomer),
      });
    } else {
      await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify(editingCustomer),
      });
    }
    setEditingCustomer(null);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Comprobantes de Venta y Clientes</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            Historial de comprobantes emitidos, reimpresión, anulaciones y directorio de clientes.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setSubTab('facturas')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'facturas' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
            }`}
          >
            Comprobantes emitidos ({invoices.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('clientes')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'clientes' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
            }`}
          >
            Directorio de clientes ({customers.length})
          </button>
        </div>
      </div>

      {subTab === 'facturas' && (
        <div className="space-y-4">
          <input
            type="text"
            value={searchInv}
            onChange={(e) => setSearchInv(e.target.value)}
            placeholder="Buscar comprobante por número, fecha o nombre de cliente..."
            className="w-full sm:w-96 px-3.5 py-2 text-xs border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
          />

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                    <th className="py-3 px-4 font-semibold">N.º Comprobante</th>
                    <th className="py-3 px-4 font-semibold">Canal / Pedido</th>
                    <th className="py-3 px-4 font-semibold">Cliente</th>
                    <th className="py-3 px-4 font-semibold">Emisión</th>
                    <th className="py-3 px-4 font-semibold">Estado</th>
                    <th className="py-3 px-4 font-semibold text-right">Total</th>
                    <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                      <td className="py-3 px-4 font-mono font-semibold text-[#202633]">{inv.invoice_number}</td>
                      <td className="py-3 px-4 text-[#202633]/75">
                        {inv.channel === 'pos' ? 'POS' : 'En línea'} ·{' '}
                        <span className="font-mono">{inv.order_number}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#202633]">{inv.customer_name}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[#202633]/65">{inv.issued_at}</td>
                      <td className="py-3 px-4">
                        {inv.status === 'anulada' ? (
                          <span className="text-red-700 font-semibold">Anulada ({inv.credit_note_number})</span>
                        ) : (
                          <span className="text-[#0A7830] font-semibold">Emitida</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-sans tabular-nums font-bold text-[#202633]">
                        {formatCurrency(inv.total)}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#2054C9]/10 hover:bg-[#2054C9]/15 text-[#2054C9] rounded font-semibold"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Ver / Reimprimir
                        </button>
                        {inv.status === 'emitida' && (
                          <button
                            type="button"
                            onClick={() => setVoidingInv(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded font-semibold"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Anular
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'clientes' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                setEditingCustomer({ name: '', phone: '', email: '', rtn: '', razon_social: '', notes: '', addresses: [] })
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Registrar cliente
            </button>
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                    <th className="py-3 px-4 font-semibold">Cliente</th>
                    <th className="py-3 px-4 font-semibold">Teléfono</th>
                    <th className="py-3 px-4 font-semibold">Correo / Referencia</th>
                    <th className="py-3 px-4 font-semibold text-right">Compras</th>
                    <th className="py-3 px-4 font-semibold text-right">Total comprado</th>
                    <th className="py-3 px-4 font-semibold">Observaciones</th>
                    <th className="py-3 px-4 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                      <td className="py-3 px-4 font-semibold text-[#202633]">{c.name}</td>
                      <td className="py-3 px-4 font-mono text-[#202633]/70">{c.phone}</td>
                      <td className="py-3 px-4">
                        <div className="text-[#202633]">{c.email || '—'}</div>
                        <div className="text-[11px] text-[#202633]/55">{c.razon_social}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-sans tabular-nums">{c.orders_count || 0}</td>
                      <td className="py-3 px-4 text-right font-sans tabular-nums font-bold text-[#202633]">
                        {formatCurrency(c.total_spent)}
                      </td>
                      <td className="py-3 px-4 text-[#202633]/60 max-w-xs truncate">{c.notes || '—'}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingCustomer(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] rounded font-semibold"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && <InvoiceModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}

      {voidingInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
          <form onSubmit={handleVoidInvoice} className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-[#202633] font-sans">
              Anular comprobante {voidingInv.invoice_number}
            </h3>
            <p className="text-xs text-[#202633]/70">
              Se generará la nota de anulación correspondiente y el comprobante quedará marcado como anulado.
            </p>
            <div>
              <label className="block text-xs font-semibold text-[#202633]/80 mb-1">Motivo de anulación *</label>
              <input
                type="text"
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Ej. Error en pedido o devolución total"
                className="w-full px-3 py-2 text-xs border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVoidingInv(null)} className="px-4 py-2 text-xs font-medium bg-[#FFF4E5] text-[#202633] rounded-lg">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-2 text-xs bg-red-700 text-white font-semibold rounded-lg">
                Anular y emitir Nota de Crédito
              </button>
            </div>
          </form>
        </div>
      )}

      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
          <form onSubmit={handleSaveCustomer} className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-lg p-6 space-y-4 text-xs">
            <h3 className="text-base font-bold text-[#202633] font-sans">
              {editingCustomer.id ? 'Editar cliente' : 'Registrar cliente'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Nombre *</label>
                <input
                  type="text"
                  required
                  value={editingCustomer.name || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Teléfono *</label>
                <input
                  type="text"
                  required
                  value={editingCustomer.phone || ''}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">Referencia / Empresa</label>
              <input
                type="text"
                value={editingCustomer.razon_social || ''}
                onChange={(e) => setEditingCustomer({ ...editingCustomer, razon_social: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">Observaciones internas</label>
              <textarea
                rows={2}
                value={editingCustomer.notes || ''}
                onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingCustomer(null)} className="px-4 py-2 bg-[#FFF4E5] text-[#202633] font-medium rounded-lg">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white font-semibold rounded-lg">
                Guardar cliente
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
