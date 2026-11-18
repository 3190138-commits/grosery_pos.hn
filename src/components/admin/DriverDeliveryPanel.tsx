import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin,
  Navigation,
  Phone,
  Play,
  Square,
  CheckCircle2,
  Bell,
  ExternalLink,
  Compass,
  Clock,
  LocateFixed,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { ComputedRoute, DeliveryNotification, DriverLocation, Order, UserAccount } from '../../types';
import { apiFetch, formatCurrency, ORDER_STATUS_LABELS, getStatusColorClass } from '../../lib/api';
import { buildGoogleMapsDirectionsUrl, subscribeRealtimeRoom } from '../../lib/realtime';
import { DeliveryMap } from '../DeliveryMap';

interface DriverDeliveryPanelProps {
  currentUser: UserAccount;
  onOrderUpdated: () => void;
}

export const DriverDeliveryPanel: React.FC<DriverDeliveryPanelProps> = ({ currentUser, onOrderUpdated }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<DeliveryNotification[]>([]);
  const [store, setStore] = useState({ name: 'Los Patrones Mini Market', address: '', hours: '', lat: 15.612194, lng: -87.939167 });
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [route, setRoute] = useState<ComputedRoute | null>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number; accuracy?: number; speed_kmh?: number } | null>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [filterTab, setFilterTab] = useState<'activas' | 'completadas'>('activas');
  const [liveAlert, setLiveAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastSentAtRef = useRef<number>(0);

  const loadData = async () => {
    try {
      const data = await apiFetch<{
        orders: Order[];
        notifications: DeliveryNotification[];
        my_location: DriverLocation | null;
        store: { name: string; address: string; hours: string; lat: number; lng: number };
      }>('/api/driver/deliveries');
      setOrders(data.orders);
      setNotifications(data.notifications);
      setStore(data.store);
      if (data.my_location && data.my_location.is_tracking === 1) {
        setDriverPos({
          lat: data.my_location.lat,
          lng: data.my_location.lng,
          accuracy: data.my_location.accuracy_m,
          speed_kmh: data.my_location.speed_kmh,
        });
      }
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
    loadData();
    const unsubscribe = subscribeRealtimeRoom({
      room: 'driver',
      onMessage: (msg) => {
        if (msg.type === 'driver:assigned' && msg.order) {
          setLiveAlert(`Nueva entrega asignada: ${msg.order.order_number} · ${msg.order.customer_name}`);
          loadData();
        }
      },
    });
    return () => {
      unsubscribe();
    };
  }, [currentUser.id]);

  // Fetch OSRM route whenever selectedOrder or store changes
  useEffect(() => {
    if (!selectedOrder || !selectedOrder.delivery_lat || !selectedOrder.delivery_lng) {
      setRoute(null);
      return;
    }
    const originLat = driverPos && selectedOrder.status === 'en_camino' ? driverPos.lat : store.lat;
    const originLng = driverPos && selectedOrder.status === 'en_camino' ? driverPos.lng : store.lng;
    apiFetch<ComputedRoute>(
      `/api/maps/route?originLat=${originLat}&originLng=${originLng}&destLat=${selectedOrder.delivery_lat}&destLng=${selectedOrder.delivery_lng}`
    )
      .then(setRoute)
      .catch(() => setRoute(null));
  }, [selectedOrder?.id, selectedOrder?.delivery_lat, selectedOrder?.delivery_lng, selectedOrder?.status, store.lat, store.lng]);

  // Stop geolocation watch cleanly on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const stopGpsSharing = async (notifyServer = true) => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsActive(false);
    if (notifyServer) {
      try {
        await apiFetch('/api/driver/stop-tracking', { method: 'POST' });
      } catch {
        // ignore
      }
    }
  };

  const sendLocationPoint = async (orderId: number, lat: number, lng: number, heading = 0, speedKmh = 0, accuracyM = 10) => {
    setDriverPos({ lat, lng, accuracy: accuracyM, speed_kmh: speedKmh });
    try {
      await apiFetch('/api/driver/location', {
        method: 'POST',
        body: JSON.stringify({
          order_id: orderId,
          lat,
          lng,
          heading,
          speed_kmh: speedKmh,
          accuracy_m: accuracyM,
        }),
      });
    } catch {
      // ignore transient network errors during watch
    }
  };

  const startDeviceGpsWatch = (orderId: number) => {
    setGpsError('');
    if (!('geolocation' in navigator)) {
      setGpsError('Este dispositivo o navegador no soporta geolocalización GPS.');
      return;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setGpsActive(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentAtRef.current < 3000) return;
        lastSentAtRef.current = now;
        const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        sendLocationPoint(
          orderId,
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.heading || 0,
          speedKmh,
          Math.round(pos.coords.accuracy || 15)
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Permiso de ubicación denegado en el dispositivo. Habilita el GPS en tu navegador para compartir tu ruta en tiempo real.');
        } else {
          setGpsError('No se pudo obtener la señal GPS exacta del dispositivo. Verifica que la ubicación esté activada.');
        }
        setGpsActive(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 12000,
      }
    );
  };

  const handleStartDelivery = async (order: Order) => {
    setBusy(true);
    setGpsError('');
    try {
      let initLat = store.lat;
      let initLng = store.lng;
      if ('geolocation' in navigator) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              initLat = pos.coords.latitude;
              initLng = pos.coords.longitude;
              resolve();
            },
            () => resolve(),
            { enableHighAccuracy: true, timeout: 4000 }
          );
        });
      }
      await apiFetch(`/api/orders/${order.id}/start-delivery`, {
        method: 'POST',
        body: JSON.stringify({ lat: initLat, lng: initLng }),
      });
      setDriverPos({ lat: initLat, lng: initLng, accuracy: 15, speed_kmh: 0 });
      startDeviceGpsWatch(order.id);
      await loadData();
      onOrderUpdated();
    } catch (err: any) {
      setGpsError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkDelivered = async (order: Order) => {
    setBusy(true);
    try {
      await stopGpsSharing(false);
      await apiFetch(`/api/orders/${order.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'entregado' }),
      });
      await loadData();
      onOrderUpdated();
    } catch (err: any) {
      setGpsError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const activeOrders = useMemo(
    () => orders.filter((o) => !['entregado', 'rechazado', 'cancelado'].includes(o.status)),
    [orders]
  );
  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'entregado'),
    [orders]
  );
  const displayedOrders = filterTab === 'activas' ? activeOrders : completedOrders;

  const googleMapsUrl = useMemo(() => {
    if (!selectedOrder?.delivery_lat || !selectedOrder?.delivery_lng) return '#';
    const oLat = driverPos && selectedOrder.status === 'en_camino' ? driverPos.lat : store.lat;
    const oLng = driverPos && selectedOrder.status === 'en_camino' ? driverPos.lng : store.lng;
    return buildGoogleMapsDirectionsUrl(oLat, oLng, selectedOrder.delivery_lat, selectedOrder.delivery_lng);
  }, [selectedOrder, driverPos, store]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Mapa y entregas del repartidor</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            Visualiza rutas desde el establecimiento (15°36'43.9"N 87°56'21.0"W), activa tu GPS en curso y abre Google Maps.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {gpsActive && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#13B64B] text-[#202633] text-xs font-bold rounded-lg">
              <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
              GPS compartiendo en vivo
            </span>
          )}
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>
      </div>

      {liveAlert && (
        <div className="flex items-center justify-between gap-3 p-3.5 bg-[#F9D94A]/45 border border-[#F9D94A] rounded-xl text-xs text-[#202633]">
          <div className="flex items-center gap-2 font-semibold">
            <Bell className="w-4 h-4 text-[#2054C9] shrink-0" />
            <span>{liveAlert}</span>
          </div>
          <button type="button" onClick={() => setLiveAlert(null)} className="font-bold underline">
            Entendido
          </button>
        </div>
      )}

      {notifications.some((n) => !n.is_read) && (
        <div className="bg-white border border-[#2054C9]/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#2054C9] flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" />
              Notificaciones recientes de asignación
            </span>
          </div>
          <div className="space-y-1.5">
            {notifications.filter((n) => !n.is_read).slice(0, 3).map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-3 text-xs bg-[#FFF4E5]/70 px-3 py-2 rounded-lg">
                <div>
                  <span className="font-semibold text-[#202633]">{n.title}: </span>
                  <span className="text-[#202633]/80">{n.message}</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
                    loadData();
                  }}
                  className="text-[11px] font-semibold text-[#2054C9] hover:underline shrink-0"
                >
                  Marcar leída
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Assigned Orders List */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setFilterTab('activas')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterTab === 'activas' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
              }`}
            >
              Por entregar ({activeOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('completadas')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterTab === 'completadas' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
              }`}
            >
              Entregadas ({completedOrders.length})
            </button>
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden divide-y divide-[#202633]/8 max-h-[560px] overflow-y-auto">
            {displayedOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#202633]/60">
                No tienes entregas {filterTab === 'activas' ? 'pendientes o en curso' : 'completadas'} en este momento.
              </div>
            ) : (
              displayedOrders.map((ord) => (
                <button
                  key={ord.id}
                  type="button"
                  onClick={() => setSelectedOrder(ord)}
                  className={`w-full p-4 text-left hover:bg-[#FFF4E5]/45 transition-colors flex items-start justify-between gap-3 ${
                    selectedOrder?.id === ord.id ? 'bg-[#2054C9]/8 border-l-4 border-l-[#2054C9]' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-[#202633]">{ord.order_number}</span>
                      <span className={`font-semibold ${getStatusColorClass(ord.status)}`}>
                        {ORDER_STATUS_LABELS[ord.status]}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[#202633] mt-1 truncate">{ord.customer_name}</p>
                    <p className="text-xs text-[#202633]/65 mt-0.5 line-clamp-1">{ord.delivery_address}</p>
                    {ord.estimated_distance_km && (
                      <p className="text-[11px] text-[#2054C9] font-semibold mt-1">
                        {ord.estimated_distance_km} km · ~{ord.estimated_duration_min} min
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-sans font-bold tabular-nums text-[#202633] shrink-0">
                    {formatCurrency(ord.total)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Active Map & Navigation Details */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedOrder ? (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-12 text-center text-xs text-[#202633]/65">
              Selecciona una entrega asignada para ver el mapa, ruta e indicaciones de navegación.
            </div>
          ) : (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#202633]/12">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-lg text-[#202633]">{selectedOrder.order_number}</span>
                    <span className={`text-xs font-bold ${getStatusColorClass(selectedOrder.status)}`}>
                      {ORDER_STATUS_LABELS[selectedOrder.status]}
                    </span>
                  </div>
                  <p className="text-xs text-[#202633]/65 mt-0.5">
                    {selectedOrder.delivery_zone_name} · {selectedOrder.payment_method === 'efectivo' ? 'Cobro en efectivo' : 'Pagado por transferencia'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedOrder.delivery_lat && selectedOrder.delivery_lng && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#FFF4E5] hover:bg-[#F9D94A]/45 text-[#202633] border border-[#202633]/20 text-xs font-bold rounded-lg whitespace-nowrap shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#2054C9]" />
                      Abrir en Google Maps
                    </a>
                  )}

                  {selectedOrder.status !== 'entregado' && selectedOrder.status !== 'rechazado' && selectedOrder.status !== 'cancelado' && (
                    <>
                      {selectedOrder.status !== 'en_camino' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleStartDelivery(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-bold rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Iniciar entrega y activar GPS
                        </button>
                      ) : !gpsActive ? (
                        <button
                          type="button"
                          onClick={() => startDeviceGpsWatch(selectedOrder.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-bold rounded-lg whitespace-nowrap shrink-0"
                        >
                          <LocateFixed className="w-3.5 h-3.5" />
                          Reanudar GPS en vivo
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => stopGpsSharing(true)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#FFF4E5] hover:bg-[#F9D94A]/45 text-[#202633] border border-[#202633]/20 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
                        >
                          <Square className="w-3.5 h-3.5" />
                          Pausar GPS
                        </button>
                      )}

                      {selectedOrder.status === 'en_camino' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleMarkDelivered(selectedOrder)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] text-xs font-bold rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Marcar entregado
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {gpsError && (
                <div className="flex items-start gap-2.5 p-3 bg-[#F9D94A]/35 border border-[#F9D94A] rounded-lg text-xs text-[#202633]">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#8A6D00]" />
                  <span>{gpsError}</span>
                </div>
              )}

              {/* Customer Contact & Delivery Instructions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-[#FFF4E5]/60 p-4 rounded-xl border border-[#202633]/12">
                <div className="space-y-1.5">
                  <p className="font-bold text-[#202633]">Cliente y contacto</p>
                  <p className="text-sm font-semibold text-[#202633]">{selectedOrder.customer_name}</p>
                  {selectedOrder.customer_phone && (
                    <a
                      href={`tel:${selectedOrder.customer_phone}`}
                      className="inline-flex items-center gap-1.5 text-[#2054C9] font-mono font-semibold hover:underline"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      {selectedOrder.customer_phone}
                    </a>
                  )}
                  <p className="text-[#202633] font-sans font-bold tabular-nums pt-1">
                    Total a {selectedOrder.payment_method === 'efectivo' ? 'cobrar' : 'entregar'}: {formatCurrency(selectedOrder.total)}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-bold text-[#202633]">Dirección e indicaciones</p>
                  <p className="text-[#202633] flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#2054C9] shrink-0 mt-0.5" />
                    <span>{selectedOrder.delivery_address}</span>
                  </p>
                  {selectedOrder.delivery_reference && (
                    <p className="text-[#202633]/75">
                      <span className="font-semibold">Referencias:</span> {selectedOrder.delivery_reference}
                    </p>
                  )}
                  {selectedOrder.delivery_notes && (
                    <p className="text-[#202633]/75">
                      <span className="font-semibold">Indicaciones:</span> {selectedOrder.delivery_notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Distance & ETA Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-white border border-[#202633]/12 rounded-lg flex items-center gap-2.5">
                  <Compass className="w-4 h-4 text-[#2054C9] shrink-0" />
                  <div>
                    <p className="text-[#202633]/60">Distancia de ruta</p>
                    <p className="text-sm font-bold text-[#202633] tabular-nums">
                      {route ? `${route.distance_km} km` : selectedOrder.estimated_distance_km ? `${selectedOrder.estimated_distance_km} km` : '—'}
                    </p>
                  </div>
                </div>
                <div className="p-3 bg-white border border-[#202633]/12 rounded-lg flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-[#2054C9] shrink-0" />
                  <div>
                    <p className="text-[#202633]/60">Tiempo estimado</p>
                    <p className="text-sm font-bold text-[#202633] tabular-nums">
                      {route ? `${route.duration_min} min` : selectedOrder.estimated_duration_min ? `${selectedOrder.estimated_duration_min} min` : '—'}
                    </p>
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1 p-3 bg-white border border-[#202633]/12 rounded-lg flex items-center gap-2.5">
                  <LocateFixed className={`w-4 h-4 shrink-0 ${gpsActive ? 'text-[#0A7830]' : 'text-[#202633]/40'}`} />
                  <div>
                    <p className="text-[#202633]/60">Tu GPS</p>
                    <p className="text-xs font-bold text-[#202633]">
                      {gpsActive && driverPos ? `Activo (±${driverPos.accuracy || 15}m)` : selectedOrder.status === 'entregado' ? 'Finalizado' : 'En espera'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Interactive Map */}
              <DeliveryMap
                store={store}
                destination={
                  selectedOrder.delivery_lat && selectedOrder.delivery_lng
                    ? {
                        lat: selectedOrder.delivery_lat,
                        lng: selectedOrder.delivery_lng,
                        label: `Entrega · ${selectedOrder.customer_name}`,
                        address: selectedOrder.delivery_address,
                      }
                    : null
                }
                driver={
                  driverPos && selectedOrder.status === 'en_camino'
                    ? {
                        lat: driverPos.lat,
                        lng: driverPos.lng,
                        name: currentUser.name,
                        eta_min: route?.duration_min || selectedOrder.estimated_duration_min,
                      }
                    : null
                }
                routeGeometry={route?.geometry || []}
                heightClass="h-[340px] sm:h-[400px]"
              />

              {/* Turn-by-turn navigation steps */}
              {route && route.steps.length > 0 && (
                <div className="border border-[#202633]/12 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#FFF4E5]/70 border-b border-[#202633]/10 flex items-center justify-between">
                    <span className="text-xs font-bold text-[#202633] flex items-center gap-1.5">
                      <Navigation className="w-3.5 h-3.5 text-[#2054C9]" />
                      Indicaciones de navegación ({route.steps.length} pasos)
                    </span>
                    <span className="text-[11px] text-[#202633]/60">
                      {route.fallback ? 'Ruta estimada' : 'Ruta vial'}
                    </span>
                  </div>
                  <ol className="divide-y divide-[#202633]/8 max-h-52 overflow-y-auto text-xs">
                    {route.steps.map((step, idx) => (
                      <li key={idx} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <span className="text-[#202633]">
                          <span className="font-mono font-bold text-[#2054C9] mr-2">{idx + 1}.</span>
                          {step.instruction}
                        </span>
                        {step.distance_m > 0 && (
                          <span className="font-sans tabular-nums text-[#202633]/60 shrink-0">
                            {step.distance_m >= 1000 ? `${(step.distance_m / 1000).toFixed(1)} km` : `${step.distance_m} m`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
