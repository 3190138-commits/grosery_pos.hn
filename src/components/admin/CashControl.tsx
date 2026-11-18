import React, { useEffect, useState } from 'react';
import { LockOpen, Lock, PlusCircle } from 'lucide-react';
import type { CashMovement, CashSession } from '../../types';
import { apiFetch, formatCurrency } from '../../lib/api';

export const CashControl: React.FC = () => {
  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [history, setHistory] = useState<CashSession[]>([]);
  const [openingAmount, setOpeningAmount] = useState('1500');
  const [movType, setMovType] = useState<'entrada' | 'salida' | 'gasto'>('gasto');
  const [movAmount, setMovAmount] = useState('');
  const [movConcept, setMovConcept] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [cur, hist] = await Promise.all([
        apiFetch<{ session: CashSession | null; movements: CashMovement[] }>('/api/cash/current'),
        apiFetch<CashSession[]>('/api/cash/history'),
      ]);
      setSession(cur.session);
      setMovements(cur.movements);
      setHistory(hist);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/cash/open', {
        method: 'POST',
        body: JSON.stringify({ opening_amount: Number(openingAmount || 0) }),
      });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/cash/movement', {
        method: 'POST',
        body: JSON.stringify({ type: movType, amount: Number(movAmount), concept: movConcept }),
      });
      setMovAmount('');
      setMovConcept('');
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/cash/close', {
        method: 'POST',
        body: JSON.stringify({ counted_cash: Number(countedCash), notes: closeNotes }),
      });
      setCountedCash('');
      setCloseNotes('');
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl text-[#202633] font-display">Control y Arqueo de Caja</h2>
        <p className="text-xs text-[#202633]/65 mt-0.5">
          Apertura, registro de entradas/salidas/gastos, ventas en efectivo y transferencias, cierre y reporte de diferencias.
        </p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{error}</div>}

      {!session ? (
        <div className="bg-white border border-[#202633]/12 rounded-xl p-6 max-w-md space-y-4">
          <h3 className="text-base font-bold text-[#202633] font-sans flex items-center gap-2">
            <LockOpen className="w-4 h-4 text-[#2054C9]" />
            Apertura de caja
          </h3>
          <form onSubmit={handleOpen} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#202633]/80 mb-1">Efectivo inicial en gaveta (L.)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-sans font-bold tabular-nums border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] text-xs font-bold rounded-lg transition-colors"
            >
              Abrir turno de caja
            </button>
          </form>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#202633]/12">
                <div>
                  <span className="text-xs font-bold text-[#0A7830]">Caja abierta</span>
                  <h3 className="text-base font-bold text-[#202633] font-sans">
                    Responsable: {session.opened_by_name}
                  </h3>
                  <p className="text-xs text-[#202633]/60 font-mono">Apertura: {session.opened_at}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[#202633]/65">Saldo esperado en efectivo</span>
                  <p className="text-2xl font-bold font-sans tabular-nums text-[#2054C9]">
                    {formatCurrency(session.expected_cash)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/10">
                  <span className="text-[#202633]/65">Fondo inicial</span>
                  <p className="font-sans tabular-nums font-bold text-[#202633] mt-0.5">{formatCurrency(session.opening_amount)}</p>
                </div>
                <div className="p-3 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/10">
                  <span className="text-[#202633]/65">Ventas en efectivo</span>
                  <p className="font-sans tabular-nums font-bold text-[#0A7830] mt-0.5">{formatCurrency(session.cash_sales_total)}</p>
                </div>
                <div className="p-3 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/10">
                  <span className="text-[#202633]/65">Transferencias POS</span>
                  <p className="font-sans tabular-nums font-bold text-[#2054C9] mt-0.5">{formatCurrency(session.transfer_sales_total)}</p>
                </div>
                <div className="p-3 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/10">
                  <span className="text-[#202633]/65">Entradas de dinero</span>
                  <p className="font-sans tabular-nums font-bold text-[#202633] mt-0.5">{formatCurrency(session.entries_total)}</p>
                </div>
                <div className="p-3 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/10">
                  <span className="text-[#202633]/65">Salidas de dinero</span>
                  <p className="font-sans tabular-nums font-bold text-[#8A6D00] mt-0.5">-{formatCurrency(session.withdrawals_total)}</p>
                </div>
                <div className="p-3 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/10">
                  <span className="text-[#202633]/65">Gastos registrados</span>
                  <p className="font-sans tabular-nums font-bold text-red-700 mt-0.5">-{formatCurrency(session.expenses_total)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-[#202633] font-sans flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-[#2054C9]" />
                Registrar entrada, salida o gasto de caja
              </h3>
              <form onSubmit={handleMovement} className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
                <select
                  value={movType}
                  onChange={(e) => setMovType(e.target.value as any)}
                  className="sm:col-span-3 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  <option value="entrada">Entrada (+)</option>
                  <option value="salida">Salida (-)</option>
                  <option value="gasto">Gasto (-)</option>
                </select>
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  placeholder="Monto L."
                  value={movAmount}
                  onChange={(e) => setMovAmount(e.target.value)}
                  className="sm:col-span-3 px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
                />
                <input
                  type="text"
                  required
                  placeholder="Concepto (Ej. Pago hielo / cambio)"
                  value={movConcept}
                  onChange={(e) => setMovConcept(e.target.value)}
                  className="sm:col-span-4 px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 py-2 px-3 bg-[#2054C9] hover:bg-[#1943A3] text-white font-semibold rounded-lg"
                >
                  Registrar
                </button>
              </form>

              {movements.length > 0 && (
                <div className="pt-3 border-t border-[#202633]/10 space-y-2 text-xs">
                  {movements.map((m) => (
                    <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-[#202633]/6">
                      <div>
                        <span className="font-semibold uppercase text-[11px] mr-2 text-[#202633]/55">{m.type}</span>
                        <span className="text-[#202633]">{m.concept}</span>
                        <span className="text-[#202633]/45 ml-2">({m.user_name})</span>
                      </div>
                      <span
                        className={`font-sans tabular-nums font-bold ${
                          m.type === 'entrada' ? 'text-[#0A7830]' : 'text-red-700'
                        }`}
                      >
                        {m.type === 'entrada' ? '+' : '-'}
                        {formatCurrency(m.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-[#202633] font-sans flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#202633]/75" />
              Cierre y arqueo de caja
            </h3>
            <form onSubmit={handleClose} className="space-y-4 text-xs">
              <div className="p-3 bg-[#FFF4E5]/60 border border-[#202633]/12 rounded-lg flex justify-between items-center">
                <span className="text-[#202633]/70">Saldo esperado en efectivo</span>
                <span className="font-sans tabular-nums font-bold text-sm text-[#202633]">
                  {formatCurrency(session.expected_cash)}
                </span>
              </div>
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Efectivo contado físico (Arqueo L.) *</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-sans tabular-nums font-bold border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              {countedCash !== '' && (
                <div className="p-3 border border-[#202633]/12 rounded-lg flex justify-between items-center bg-[#FFF4E5]/40">
                  <span className="text-[#202633]/70">Diferencia detectada</span>
                  <span
                    className={`font-sans tabular-nums font-bold text-sm ${
                      Number(countedCash) - session.expected_cash === 0
                        ? 'text-[#0A7830]'
                        : 'text-red-700'
                    }`}
                  >
                    {formatCurrency(Number(countedCash) - session.expected_cash)}
                  </span>
                </div>
              )}
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Observaciones de cierre</label>
                <textarea
                  rows={2}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Comentarios del arqueo..."
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-[#202633] hover:bg-[#202633]/90 text-white font-semibold rounded-lg"
              >
                Cerrar caja y guardar arqueo
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Historial de cierres */}
      <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#202633]/12">
          <h3 className="text-sm font-bold text-[#202633] font-sans">Historial de cierres y diferencias</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                <th className="py-3 px-4 font-semibold">Responsable</th>
                <th className="py-3 px-4 font-semibold">Apertura / Cierre</th>
                <th className="py-3 px-4 font-semibold text-right">Inicial</th>
                <th className="py-3 px-4 font-semibold text-right">Esperado</th>
                <th className="py-3 px-4 font-semibold text-right">Contado</th>
                <th className="py-3 px-4 font-semibold text-right">Diferencia</th>
                <th className="py-3 px-4 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                  <td className="py-3 px-4 font-semibold text-[#202633]">{h.opened_by_name}</td>
                  <td className="py-3 px-4 font-mono text-[#202633]/65">
                    {h.opened_at} {h.closed_at ? `→ ${h.closed_at}` : ''}
                  </td>
                  <td className="py-3 px-4 text-right font-sans tabular-nums">{formatCurrency(h.opening_amount)}</td>
                  <td className="py-3 px-4 text-right font-sans tabular-nums">{formatCurrency(h.expected_cash)}</td>
                  <td className="py-3 px-4 text-right font-sans tabular-nums">
                    {h.counted_cash !== null ? formatCurrency(h.counted_cash) : '—'}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-sans tabular-nums font-bold ${
                      h.difference === 0 || h.difference === null ? 'text-[#0A7830]' : 'text-red-700'
                    }`}
                  >
                    {h.difference !== null ? formatCurrency(h.difference) : '—'}
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#202633]">{h.status === 'abierta' ? 'Abierta' : 'Cerrada'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
