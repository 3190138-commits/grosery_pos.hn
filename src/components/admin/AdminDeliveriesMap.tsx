import React, { useEffect, useMemo, useState } from 'react';
import { Truck, Clock, AlertTriangle, CheckCircle2, MapPin, RefreshCw, Phone } from 'lucide-react';
import type { ComputedRoute, DriverLocation, Order, UserAccount } from '../../types';
import { apiFetch, formatCurrency, ORDER_STATUS_LABELS, getStatusColorClass } from '../../lib/api';
import { subscribeRealtimeRoom } from '../../lib/realtime';
import { DeliveryMap } from '../DeliveryMap';

interface AdminDeliveryOrder extends Order {
  elapsed_min?: number;
  is_delayed?: boolean;
}

interface AdminDeliveriesMapProps {
  onOrderUpdated: () => void;
}

export const AdminDeliveriesMap: React.FC<AdminDeliveriesMapProps> = ({ onOrderUpdated }) => {
  const [orders, setOrders] = useState<AdminDeliveryOrder[]>([]);
  const [activeDrivers, setActiveDrivers] = useState<DriverLocation[]>([]);
  const [drivers, setDrivers] = useState<UserAccount[]>([]);
  const [store, setStore] = useState({ name: 'Los Patrones Mini Market', address: '', hours: '', lat: 15.612194, lng: -87.939167 });
  const [filter, setFilter] = useState<'activas' | 'pendientes' | 'retrasadas' | 'completadas'>('activas');
  const [selectedOrder, setSelectedOrder] = useState<AdminDeliveryOrder | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<ComputedRoute | null>(null);

  const loadDeliveries = async () => {
    try {
      const data = await apiFetch<{
        orders: AdminDeliveryOrder[];
        active_drivers: DriverLocation[];
        drivers: UserAccount[];
        store: { name: string; address: string; hours: string; lat: number; lng: number };
      }>('/api/admin/deliveries');
      setOrders(data.orders);
      setActiveDrivers(data.active_drivers);
      setDrivers(data.drivers);
      setStore(data.store);
      setSelectedOrder((prev) => {
        if (prev) {
          const found = data.orders.find((o) => o.id === prev.id);
          if (found) return found;
        }
        return (
          data.orders.find((o) => o.status === 'en_camino') ||
          data.orders.find((o) => !['entregado', 'rechazado', 'cancelado'].includes(o.status)) ||
          data.orders[0] ||
          null
        );
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadDeliveries();
    const unsub = subscribeRealtimeRoom({
      room: 'admin',
      onMessage: (msg) => {
        if (msg.type === 'driver:location') {
          setActiveDrivers((prev) => {
            const idx = prev.findIndex((d) => d.driver_id === msg.driver_id);
            const updated: DriverLocation = {
              driver_id: msg.driver_id,
              driver_name: msg.driver_name,
              order_id: msg.order_id,
              order_number: msg.order_number,
              lat: msg.lat,
              lng: msg.lng,
              heading: msg.heading || 0,
              speed_kmh: msg.speed_kmh || 0,
              accuracy_m: msg.accuracy_m || 10,
              is_tracking: 1,
              updated_at: msg.updated_at,
              remaining_km: msg.remaining_km,
              eta_min: msg.eta_min,
            };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...updated };
              return copy;
            }
            return [...prev, updated];
          });
        } else if (msg.type === 'driver:stopped' || msg.type === 'order:updated' || msg.type === 'order:created') {
          loadDeliveries();
        }
      },
    });
    const timer = window.setInterval(loadDeliveries, 30000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedOrder?.delivery_lat || !selectedOrder?.delivery_lng) {
      setSelectedRoute(null);
      return;
    }
    apiFetch<ComputedRoute>(
      `/api/maps/route?originLat=${store.lat}&originLng=${store.lng}&destLat=${selectedOrder.delivery_lat}&destLng=${selectedOrder.delivery_lng}`
    )
      .then(setSelectedRoute)
      .catch(() => setSelectedRoute(null));
  }, [selectedOrder?.id, selectedOrder?.delivery_lat, selectedOrder?.delivery_lng, store.lat, store.lng]);

  const assignDriver = async (orderId: number, driverId: number | null) => {
    await apiFetch(`/api/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ assigned_driver_id: driverId }),
    });
    await loadDeliveries();
    onOrderUpdated();
  };

  const pendingOrders = useMemo(
    () => orders.filter((o) => ['recibido', 'confirmado', 'en_preparacion'].includes(o.status)),
    [orders]
  );
  const activeRouteOrders = useMemo(
    () => orders.filter((o) => o.status === 'en_camino'),
    [orders]
  );
  const delayedOrders = useMemo(
    () => orders.filter((o) => o.is_delayed),
    [orders]
  );
  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'entregado'),
    [orders]
  );

  const filteredList = useMemo(() => {
    switch (filter) {
      case 'pendientes':
        return pendingOrders;
      case 'retrasadas':
        return delayedOrders;
      case 'completadas':
        return completedOrders;
      case 'activas':
      default:
        return orders.filter((o) => !['entregado', 'rechazado', 'cancelado'].includes(o.status));
    }
  }, [filter, orders, pendingOrders, delayedOrders, completedOrders]);

  const mapDestinations = useMemo(
    () =>
      orders
        .filter((o) => !['entregado', 'rechazado', 'cancelado'].includes(o.status) && o.delivery_lat && o.delivery_lng)
        .map((o) => ({
          id: o.id,
          lat: Number(o.delivery_lat),
          lng: Number(o.delivery_lng),
          label: `${o.order_number} · ${o.customer_name}`,
          sublabel: `${ORDER_STATUS_LABELS[o.status]}${o.is_delayed ? ' (RETRASADA)' : ''}`,
          selected: selectedOrder?.id === o.id,
          delayed: Boolean(o.is_delayed),
        })),
    [orders, selectedOrder?.id]
  );

  const mapDrivers = useMemo(
    () =>
      activeDrivers.map((d) => ({
        id: d.driver_id,
        lat: d.lat,
        lng: d.lng,
        label: d.driver_name || `Repartidor #${d.driver_id}`,
        sublabel: `${d.order_number || 'En ruta'}${d.eta_min ? ` · ETA ~${d.eta_min} min` : ''}`,
      })),
    [activeDrivers]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Centro de entregas y mapa en vivo</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            Monitorea repartidores con GPS activo, asigna entregas pendientes e identifica pedidos retrasados (+40 min).
          </p>
        </div>
        <button
          type="button"
          onClick={loadDeliveries}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg self-start whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar mapa
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#202633]/12 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#202633]/65">
            <span>Pendientes de entrega</span>
            <Clock className="w-4 h-4 text-[#8A6D00]" />
          </div>
          <p className="text-2xl font-bold font-sans tabular-nums text-[#202633] mt-1">{pendingOrders.length}</p>
        </div>
        <div className="bg-white border border-[#202633]/12 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#202633]/65">
            <span>En camino (GPS activo)</span>
            <Truck className="w-4 h-4 text-[#2054C9]" />
          </div>
          <p className="text-2xl font-bold font-sans tabular-nums text-[#2054C9] mt-1">
            {activeRouteOrders.length} <span className="text-xs font-normal text-[#202633]/60">({activeDrivers.length} GPS)</span>
          </p>
        </div>
        <div className="bg-white border border-[#202633]/12 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#202633]/65">
            <span>Entregas retrasadas</span>
            <AlertTriangle className="w-4 h-4 text-red-700" />
          </div>
          <p className={`text-2xl font-bold font-sans tabular-nums mt-1 ${delayedOrders.length > 0 ? 'text-red-700' : 'text-[#202633]'}`}>
            {delayedOrders.length}
          </p>
        </div>
        <div className="bg-white border border-[#202633]/12 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#202633]/65">
            <span>Entregas completadas</span>
            <CheckCircle2 className="w-4 h-4 text-[#0A7830]" />
          </div>
          <p className="text-2xl font-bold font-sans tabular-nums text-[#0A7830] mt-1">{completedOrders.length}</p>
        </div>
      </div>

      {/* Live Fleet Map */}
      <div className="bg-white border border-[#202633]/12 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-bold text-[#202633]">Mapa operativo en tiempo real</span>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#202633]/75">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#2054C9] inline-block" /> Establecimiento
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#F9D94A] border border-[#202633] inline-block" /> Destino cliente
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#13B64B] inline-block" /> Repartidor GPS vivo
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-600 inline-block" /> Retrasada (&gt;40 min)
            </span>
          </div>
        </div>
        <DeliveryMap
          store={store}
          destinations={mapDestinations}
          drivers={mapDrivers}
          routeGeometry={selectedRoute?.geometry || []}
          heightClass="h-[360px] sm:h-[420px]"
          onSelectMarker={(id) => {
            const found = orders.find((o) => o.id === Number(id));
            if (found) setSelectedOrder(found);
          }}
        />
      </div>

      {/* Orders List & Detail Assignment */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg overflow-x-auto w-fit max-w-full">
            {[
              ['activas', 'Activas'],
              ['pendientes', `Pendientes (${pendingOrders.length})`],
              ['retrasadas', `Retrasadas (${delayedOrders.length})`],
              ['completadas', `Completadas (${completedOrders.length})`],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k as any)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filter === k ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden divide-y divide-[#202633]/8 max-h-[440px] overflow-y-auto">
            {filteredList.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#202633]/60">No hay entregas en esta vista.</div>
            ) : (
              filteredList.map((ord) => (
                <button
                  key={ord.id}
                  type="button"
                  onClick={() => setSelectedOrder(ord)}
                  className={`w-full p-4 text-left hover:bg-[#FFF4E5]/45 transition-colors flex items-center justify-between gap-3 ${
                    selectedOrder?.id === ord.id ? 'bg-[#2054C9]/8' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-[#202633]">{ord.order_number}</span>
                      <span className={`font-semibold ${getStatusColorClass(ord.status)}`}>
                        {ORDER_STATUS_LABELS[ord.status]}
                      </span>
                      {ord.is_delayed && (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded">
                          RETRASO {ord.elapsed_min}m
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[#202633] mt-1 truncate">{ord.customer_name}</p>
                    <p className="text-xs text-[#202633]/65 truncate">{ord.delivery_address}</p>
                    <p className="text-[11px] text-[#2054C9] font-medium mt-0.5">
                      {ord.assigned_driver_name ? `Repartidor: ${ord.assigned_driver_name}` : 'Sin repartidor asignado'}
                    </p>
                  </div>
                  <span className="font-sans font-bold text-sm tabular-nums text-[#202633] shrink-0">
                    {formatCurrency(ord.total)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-6">
          {!selectedOrder ? (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-10 text-center text-xs text-[#202633]/60">
              Selecciona una entrega para ver su ruta, repartidor asignado y detalles.
            </div>
          ) : (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between pb-3 border-b border-[#202633]/12">
                <div>
                  <h3 className="text-lg font-mono font-bold text-[#202633]">{selectedOrder.order_number}</h3>
                  <p className="text-xs text-[#202633]/65">
                    Creado: {selectedOrder.created_at}
                    {selectedOrder.dispatched_at ? ` · Salió: ${selectedOrder.dispatched_at}` : ''}
                    {selectedOrder.delivered_at ? ` · Entregado: ${selectedOrder.delivered_at}` : ''}
                  </p>
                </div>
                <span className={`text-xs font-bold ${getStatusColorClass(selectedOrder.status)}`}>
                  {ORDER_STATUS_LABELS[selectedOrder.status]}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-[#FFF4E5]/60 p-3.5 rounded-xl border border-[#202633]/12">
                <div className="space-y-1">
                  <p className="font-bold text-[#202633]">{selectedOrder.customer_name}</p>
                  <p className="font-mono text-[#202633]/75 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {selectedOrder.customer_phone}
                  </p>
                  <p className="text-[#202633]/80 flex items-start gap-1">
                    <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-[#2054C9]" />
                    <span>{selectedOrder.delivery_address}</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-[#202633]">Ruta estimada</p>
                  <p className="text-[#202633]/80">
                    Distancia: {selectedRoute?.distance_km ?? selectedOrder.estimated_distance_km ?? '—'} km
                  </p>
                  <p className="text-[#202633]/80">
                    ETA: {selectedRoute?.duration_min ?? selectedOrder.estimated_duration_min ?? '—'} min
                  </p>
                  {selectedOrder.customer_confirmed_at && (
                    <p className="text-[#0A7830] font-semibold">Confirmado por cliente</p>
                  )}
                </div>
              </div>

              {selectedOrder.status !== 'entregado' && selectedOrder.status !== 'rechazado' && selectedOrder.status !== 'cancelado' && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#202633]">Asignar repartidor</label>
                  <select
                    value={selectedOrder.assigned_driver_id || ''}
                    onChange={(e) => assignDriver(selectedOrder.id, e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-3 py-2 text-xs border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                  >
                    <option value="">Sin repartidor asignado</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.phone})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeDrivers.find((d) => d.order_id === selectedOrder.id) && (
                <div className="p-3 bg-[#13B64B]/12 border border-[#13B64B]/40 rounded-lg text-xs text-[#0A7830] font-semibold">
                  GPS en vivo activo · Última actualización:{' '}
                  {activeDrivers.find((d) => d.order_id === selectedOrder.id)?.updated_at}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
