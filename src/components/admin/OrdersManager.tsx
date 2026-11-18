import React, { useEffect, useState } from 'react';
import { FileText, Check, XCircle, Truck, RefreshCw } from 'lucide-react';
import type { Invoice, Order, OrderStatus, UserAccount } from '../../types';
import { apiFetch, formatCurrency, ORDER_STATUS_LABELS, getStatusColorClass } from '../../lib/api';
import { InvoiceModal } from '../InvoiceModal';

interface OrdersManagerProps {
  currentUser: UserAccount;
  onOrderUpdated: () => void;
}

export const OrdersManager: React.FC<OrdersManagerProps> = ({ currentUser, onOrderUpdated }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<UserAccount[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('todos');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [proofModalUrl, setProofModalUrl] = useState<string | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<Invoice | null>(null);

  const isDriver = currentUser.role === 'Repartidor';

  const loadOrders = async () => {
    const [ordRes, usrRes] = await Promise.all([
      apiFetch<Order[]>('/api/orders?channel=online'),
      isDriver ? Promise.resolve([]) : apiFetch<UserAccount[]>('/api/users').catch(() => []),
    ]);
    setOrders(ordRes);
    setDrivers(usrRes.filter((u) => u.role === 'Repartidor'));
    if (selectedOrder) {
      const updated = ordRes.find((o) => o.id === selectedOrder.id);
      if (updated) setSelectedOrder(updated);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const updateOrder = async (orderId: number, payload: { status?: OrderStatus; rejection_reason?: string; assigned_driver_id?: number | null }) => {
    await apiFetch(`/api/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    setShowRejectBox(false);
    setRejectReason('');
    await loadOrders();
    onOrderUpdated();
  };

  const openOrCreateInvoice = async (order: Order) => {
    const inv = await apiFetch<Invoice>(`/api/invoices/generate/${order.id}`, { method: 'POST' });
    setInvoiceModal(inv);
    loadOrders();
  };

  const filtered = orders.filter((o) => {
    if (filterStatus === 'todos') return true;
    return o.status === filterStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">
            {isDriver ? 'Entregas asignadas (Repartidor)' : 'Gestión de pedidos en línea'}
          </h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            {isDriver
              ? 'Consulta tus entregas asignadas, dirección del cliente y marca pedidos entregados.'
              : 'Recibe pedidos de la tienda, verifica comprobantes, asigna repartidores y emite facturas.'}
          </p>
        </div>
        <button
          type="button"
          onClick={loadOrders}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg self-start whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar cola
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg overflow-x-auto w-fit max-w-full">
        {[
          ['todos', 'Todos'],
          ['recibido', 'Recibidos'],
          ['confirmado', 'Confirmados'],
          ['en_preparacion', 'En preparación'],
          ['en_camino', 'En camino'],
          ['listo_recoger', 'Listo recoger'],
          ['entregado', 'Entregados'],
          ['rechazado', 'Rechazados'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterStatus(key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterStatus === key ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#202633]/60">No hay pedidos en este estado.</div>
          ) : (
            <div className="divide-y divide-[#202633]/8 max-h-[620px] overflow-y-auto">
              {filtered.map((ord) => (
                <button
                  key={ord.id}
                  type="button"
                  onClick={() => {
                    setSelectedOrder(ord);
                    setShowRejectBox(false);
                  }}
                  className={`w-full p-4 text-left hover:bg-[#FFF4E5]/40 transition-colors flex items-center justify-between gap-4 ${
                    selectedOrder?.id === ord.id ? 'bg-[#2054C9]/8' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-[#202633]">{ord.order_number}</span>
                      <span className="text-[#202633]/30">·</span>
                      <span className={`font-semibold ${getStatusColorClass(ord.status)}`}>
                        {ORDER_STATUS_LABELS[ord.status]}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[#202633] mt-1 truncate">{ord.customer_name}</p>
                    <p className="text-xs text-[#202633]/65 mt-0.5 truncate">
                      {ord.delivery_mode === 'domicilio' ? ord.delivery_address : 'Recoger en establecimiento'} ·{' '}
                      {ord.payment_method === 'transferencia' ? 'Transferencia' : 'Efectivo'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold font-sans tabular-nums text-[#202633]">
                      {formatCurrency(ord.total)}
                    </p>
                    <p className="text-[11px] text-[#202633]/50 font-mono mt-0.5">{ord.created_at.slice(11, 16)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6">
          {!selectedOrder ? (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-12 text-center text-xs text-[#202633]/65">
              Selecciona un pedido de la lista para revisar productos, comprobantes y actualizar su estado.
            </div>
          ) : (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-5">
              <div className="flex items-start justify-between pb-4 border-b border-[#202633]/12">
                <div>
                  <h3 className="text-lg font-bold font-mono text-[#202633]">{selectedOrder.order_number}</h3>
                  <p className="text-xs text-[#202633]/60 mt-0.5">Recibido: {selectedOrder.created_at}</p>
                </div>
                <span className={`text-xs font-semibold ${getStatusColorClass(selectedOrder.status)}`}>
                  {ORDER_STATUS_LABELS[selectedOrder.status]}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-[#FFF4E5]/60 p-4 rounded-xl border border-[#202633]/12">
                <div className="space-y-1">
                  <p className="font-semibold text-[#202633]">Datos del cliente</p>
                  <p className="text-[#202633] font-medium">{selectedOrder.customer_name}</p>
                  <p className="text-[#202633]/75 font-mono">{selectedOrder.customer_phone}</p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-[#202633]">Entrega y pago</p>
                  <p className="text-[#202633]/80">
                    {selectedOrder.delivery_mode === 'domicilio'
                      ? `${selectedOrder.delivery_address} (${selectedOrder.delivery_zone_name})`
                      : 'Recoger en tienda'}
                  </p>
                  {selectedOrder.delivery_reference && (
                    <p className="text-[#202633]/65">Ref: {selectedOrder.delivery_reference}</p>
                  )}
                  {selectedOrder.delivery_notes && (
                    <p className="text-[#202633]/65">Notas: {selectedOrder.delivery_notes}</p>
                  )}
                  <p className="text-[#202633] font-medium pt-1">
                    Pago: {selectedOrder.payment_method === 'transferencia' ? 'Transferencia bancaria' : 'Efectivo'}
                  </p>
                </div>
              </div>

              {selectedOrder.transfer_proof_url && (
                <div className="flex items-center justify-between p-3 bg-[#2054C9]/8 border border-[#2054C9]/25 rounded-lg text-xs">
                  <span className="font-semibold text-[#2054C9]">Comprobante de transferencia adjunto</span>
                  <button
                    type="button"
                    onClick={() => setProofModalUrl(selectedOrder.transfer_proof_url)}
                    className="px-3 py-1 bg-white border border-[#2054C9]/30 text-[#2054C9] font-semibold rounded hover:bg-[#2054C9]/10"
                  >
                    Ver comprobante
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[#202633]/80">Productos solicitados</p>
                <div className="border border-[#202633]/12 rounded-lg divide-y divide-[#202633]/8 text-xs">
                  {(selectedOrder.items || []).map((it) => (
                    <div key={it.id} className="flex justify-between p-2.5">
                      <span>
                        <span className="font-mono font-semibold">{it.quantity}×</span> {it.product_name}
                      </span>
                      <span className="font-sans tabular-nums font-medium">{formatCurrency(it.line_total)}</span>
                    </div>
                  ))}
                  {selectedOrder.delivery_fee > 0 && (
                    <div className="flex justify-between p-2.5 text-[#202633]/70 bg-[#FFF4E5]/50">
                      <span>Costo de envío</span>
                      <span className="font-sans tabular-nums">{formatCurrency(selectedOrder.delivery_fee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between p-2.5 font-bold text-[#202633] bg-[#FFF4E5]/60">
                    <span>Total del pedido</span>
                    <span className="font-sans tabular-nums">{formatCurrency(selectedOrder.total)}</span>
                  </div>
                </div>
              </div>

              {!isDriver && selectedOrder.delivery_mode === 'domicilio' && drivers.length > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  <Truck className="w-4 h-4 text-[#202633]/60 shrink-0" />
                  <select
                    value={selectedOrder.assigned_driver_id || ''}
                    onChange={(e) =>
                      updateOrder(selectedOrder.id, {
                        assigned_driver_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="flex-1 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                  >
                    <option value="">Sin repartidor asignado</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        Repartidor: {d.name} ({d.phone})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Workflow Actions */}
              <div className="pt-3 border-t border-[#202633]/12 flex flex-wrap gap-2">
                {!isDriver && selectedOrder.status === 'recibido' && (
                  <>
                    <button
                      type="button"
                      onClick={() => updateOrder(selectedOrder.id, { status: 'confirmado' })}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold rounded-lg"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Aceptar y confirmar pedido
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRejectBox(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-medium rounded-lg"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Rechazar pedido
                    </button>
                  </>
                )}

                {!isDriver && selectedOrder.status === 'confirmado' && (
                  <button
                    type="button"
                    onClick={() => updateOrder(selectedOrder.id, { status: 'en_preparacion' })}
                    className="px-3.5 py-2 bg-[#202633] hover:bg-[#202633]/90 text-white text-xs font-semibold rounded-lg"
                  >
                    Marcar En preparación
                  </button>
                )}

                {!isDriver && selectedOrder.status === 'en_preparacion' && (
                  <button
                    type="button"
                    onClick={() =>
                      updateOrder(selectedOrder.id, {
                        status: selectedOrder.delivery_mode === 'recoger' ? 'listo_recoger' : 'en_camino',
                      })
                    }
                    className="px-3.5 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold rounded-lg"
                  >
                    {selectedOrder.delivery_mode === 'recoger' ? 'Listo para recoger' : 'Enviar a ruta (En camino)'}
                  </button>
                )}

                {(selectedOrder.status === 'en_camino' || selectedOrder.status === 'listo_recoger') && (
                  <button
                    type="button"
                    onClick={() => updateOrder(selectedOrder.id, { status: 'entregado' })}
                    className="px-3.5 py-2 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] text-xs font-bold rounded-lg"
                  >
                    Confirmar entrega completada
                  </button>
                )}

                {!isDriver && selectedOrder.status !== 'rechazado' && selectedOrder.status !== 'cancelado' && (
                  <button
                    type="button"
                    onClick={() => openOrCreateInvoice(selectedOrder)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#FFF4E5] hover:bg-[#F9D94A]/35 text-[#202633] border border-[#202633]/15 text-xs font-semibold rounded-lg ml-auto whitespace-nowrap shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {selectedOrder.invoice_number ? `Comprobante ${selectedOrder.invoice_number}` : 'Generar comprobante'}
                  </button>
                )}
              </div>

              {showRejectBox && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
                  <label className="block text-xs font-semibold text-red-900">
                    Indica el motivo del rechazo (se repondrá el inventario automáticamente)
                  </label>
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Ej. Comprobante ilegible, fuera de cobertura..."
                    className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg bg-white"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!rejectReason.trim()}
                      onClick={() => updateOrder(selectedOrder.id, { status: 'rechazado', rejection_reason: rejectReason })}
                      className="px-3.5 py-1.5 bg-red-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                    >
                      Confirmar rechazo
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRejectBox(false)}
                      className="px-3.5 py-1.5 bg-white border border-[#202633]/20 text-xs font-semibold text-[#202633] rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {proofModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/60 p-4" onClick={() => setProofModalUrl(null)}>
          <div className="bg-white border border-[#202633]/12 rounded-xl p-4 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-bold text-[#202633]">Comprobante de transferencia bancaria</h4>
              <button type="button" onClick={() => setProofModalUrl(null)} className="text-xs font-semibold text-[#202633]/65 hover:text-[#202633]">
                Cerrar
              </button>
            </div>
            <img src={proofModalUrl} alt="Comprobante de transferencia" className="w-full max-h-[70vh] object-contain rounded-lg border border-[#202633]/12" />
          </div>
        </div>
      )}

      {invoiceModal && <InvoiceModal invoice={invoiceModal} onClose={() => setInvoiceModal(null)} />}
    </div>
  );
};
