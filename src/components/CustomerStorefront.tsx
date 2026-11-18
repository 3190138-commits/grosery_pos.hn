import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  X,
  Check,
  MapPin,
  Clock,
  Phone,
  Upload,
  PackageCheck,
  Truck,
  Store,
  AlertCircle,
  Bell,
  Navigation,
  LocateFixed,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  type BusinessSettings,
  type CartItem,
  type ComputedRoute,
  type DeliveryMode,
  type DeliveryNotification,
  type DriverLocation,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type Product,
  type Promotion,
  type UserAccount,
} from '../types';
import { apiFetch, formatCurrency, getAuthToken, ORDER_STATUS_LABELS, getStatusColorClass } from '../lib/api';
import { subscribeRealtimeRoom } from '../lib/realtime';
import { DeliveryMap } from './DeliveryMap';
import { CustomerAccount } from './CustomerAccount';
import { HelpAssistant } from './HelpAssistant';

interface CustomerStorefrontProps {
  settings: BusinessSettings;
  products: Product[];
  promotions: Promotion[];
  user: UserAccount | null;
  onLoginSuccess: (token: string, user: UserAccount) => void;
  onLogout: () => void;
  onOrderCreated: () => void;
  onOpenAdmin: () => void;
}

const HERO_IMG = '/src/assets/images/hero_minimarket_storefront_1794949338102.jpg';
const PROMO_IMG = '/src/assets/images/promo_banner_drinks_snacks_1794949337733.jpg';

export const CustomerStorefront: React.FC<CustomerStorefrontProps> = ({
  settings,
  products,
  promotions,
  user,
  onLoginSuccess,
  onLogout,
  onOrderCreated,
  onOpenAdmin,
}) => {
  const [view, setView] = useState<'inicio' | 'catalogo' | 'ofertas' | 'seguimiento' | 'cuenta'>('inicio');
  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [cardQuantities, setCardQuantities] = useState<Record<number, number>>({});

  // Checkout state
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('domicilio');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [customerName, setCustomerName] = useState(user?.name || '');
  const [customerPhone, setCustomerPhone] = useState(user?.phone || '');
  const [customerRtn, setCustomerRtn] = useState('');
  const [zoneId, setZoneId] = useState(settings.delivery_zones[0]?.id || 'centro');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [transferProofUrl, setTransferProofUrl] = useState('');
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geoNotice, setGeoNotice] = useState('');
  const [showCheckoutMap, setShowCheckoutMap] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Order tracking state
  const [trackInput, setTrackInput] = useState('PED-2026-0144');
  const [trackedOrder, setTrackedOrder] = useState<
    (Order & {
      store?: { name: string; address: string; hours: string; lat: number; lng: number };
      driver_location?: DriverLocation | null;
      notifications?: DeliveryNotification[];
    }) | null
  >(null);
  const [trackedRoute, setTrackedRoute] = useState<ComputedRoute | null>(null);
  const [driverLivePos, setDriverLivePos] = useState<DriverLocation | null>(null);
  const [trackNotifications, setTrackNotifications] = useState<DeliveryNotification[]>([]);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [trackError, setTrackError] = useState('');

  const activeCartCount = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart]);

  const cartTotals = useMemo(() => {
    let subtotal = 0;
    let discounts = 0;
    for (const item of cart) {
      const base = item.product.sale_price * item.quantity;
      const effective = (item.product.promo_price ?? item.product.sale_price) * item.quantity;
      subtotal += base;
      discounts += base - effective;
    }
    const netSubtotal = subtotal - discounts;
    const selectedZone = settings.delivery_zones.find((z) => z.id === zoneId);
    const deliveryFee = deliveryMode === 'domicilio' ? Number(selectedZone?.fee || 35) : 0;
    return {
      subtotal,
      discounts,
      netSubtotal,
      deliveryFee,
      total: netSubtotal + deliveryFee,
    };
  }, [cart, deliveryMode, zoneId, settings.delivery_zones]);

  const addToCart = (product: Product, qty = 1) => {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        const nextQty = Math.min(product.stock, existing.quantity + qty);
        return prev.map((i) => (i.product.id === product.id ? { ...i, quantity: nextQty } : i));
      }
      return [...prev, { product, quantity: Math.min(product.stock, qty) }];
    });
    setCartOpen(true);
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const nextQty = Math.min(item.product.stock, item.quantity + delta);
          return nextQty <= 0 ? null : { ...item, quantity: nextQty };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (view === 'ofertas' && !p.promo_price) return false;
      if (selectedCategory !== 'Todas' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.internal_code.toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, selectedCategory, view]);

  const featuredProducts = useMemo(() => products.filter((p) => p.is_featured === 1).slice(0, 6), [products]);
  const bestsellerProducts = useMemo(() => products.filter((p) => p.is_bestseller === 1).slice(0, 6), [products]);
  const offerProducts = useMemo(() => products.filter((p) => Boolean(p.promo_price)), [products]);

  const getStoredTrackingToken = (orderNum: string) => {
    try {
      return sessionStorage.getItem(`lpm_track_${orderNum.trim().toUpperCase()}`) || '';
    } catch {
      return '';
    }
  };

  const handleTrackSearch = async (orderNum?: string) => {
    const num = (orderNum || trackInput).trim();
    if (!num) return;
    setTrackError('');
    const trackToken = getStoredTrackingToken(num);
    try {
      const ord = await apiFetch<
        Order & {
          store?: { name: string; address: string; hours: string; lat: number; lng: number };
          driver_location?: DriverLocation | null;
          notifications?: DeliveryNotification[];
        }
      >(`/api/orders/track/${encodeURIComponent(num)}`, {
        headers: trackToken ? { 'X-Tracking-Token': trackToken } : {},
      });
      setTrackedOrder(ord);
      setDriverLivePos(ord.status === 'en_camino' ? ord.driver_location || null : null);
      setTrackNotifications(ord.notifications || []);
    } catch (err: any) {
      setTrackedOrder(null);
      setDriverLivePos(null);
      setTrackNotifications([]);
      setTrackError(err.message);
    }
  };

  // Real-time WebSocket subscription strictly isolated to the tracked order (requires authenticated session)
  useEffect(() => {
    if (view !== 'seguimiento' || !trackedOrder?.order_number || !getAuthToken()) return;
    const orderNumber = trackedOrder.order_number;
    const unsub = subscribeRealtimeRoom({
      room: `order:${orderNumber}`,
      onMessage: (msg) => {
        if (msg.type === 'order:updated' && msg.order && msg.order.order_number === orderNumber) {
          setTrackedOrder((prev) => (prev ? { ...prev, ...msg.order } : msg.order));
          if (msg.order.status !== 'en_camino') {
            setDriverLivePos(null);
          }
          if (msg.order.status === 'en_camino') {
            handleTrackSearch(orderNumber);
          }
        } else if (msg.type === 'driver:location' && msg.order_number === orderNumber) {
          setDriverLivePos({
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
          });
        } else if (msg.type === 'order:notification' && msg.notification) {
          setTrackNotifications((prev) => {
            if (prev.some((n) => n.id === msg.notification.id)) return prev;
            return [msg.notification, ...prev];
          });
        } else if (msg.type === 'tracking:stopped' && msg.order_number === orderNumber) {
          setDriverLivePos(null);
        }
      },
    });
    return () => {
      unsub();
    };
  }, [view, trackedOrder?.order_number]);

  // Fetch route for tracked order map (requires authenticated session)
  useEffect(() => {
    if (!trackedOrder || trackedOrder.delivery_mode !== 'domicilio' || !trackedOrder.delivery_lat || !trackedOrder.delivery_lng) {
      setTrackedRoute(null);
      return;
    }
    const storeLat = trackedOrder.store?.lat ?? settings.store_lat ?? 15.612194;
    const storeLng = trackedOrder.store?.lng ?? settings.store_lng ?? -87.939167;
    if (!getAuthToken()) {
      setTrackedRoute({
        geometry: [
          [storeLat, storeLng],
          [trackedOrder.delivery_lat, trackedOrder.delivery_lng],
        ],
        distance_km: trackedOrder.estimated_distance_km || 0,
        duration_min: trackedOrder.estimated_duration_min || 10,
        steps: [],
        fallback: true,
      });
      return;
    }
    apiFetch<ComputedRoute>(
      `/api/maps/route?originLat=${storeLat}&originLng=${storeLng}&destLat=${trackedOrder.delivery_lat}&destLng=${trackedOrder.delivery_lng}`
    )
      .then(setTrackedRoute)
      .catch(() => setTrackedRoute(null));
  }, [trackedOrder?.id, trackedOrder?.delivery_lat, trackedOrder?.delivery_lng, settings.store_lat, settings.store_lng]);

  const handleGeocodeCheckoutAddress = async () => {
    if (!getAuthToken()) {
      setShowCheckoutMap(true);
      setGeoNotice('Marca tu punto de entrega directamente en el mapa, o inicia sesión para usar la búsqueda automática.');
      return;
    }
    setGeocoding(true);
    setGeoNotice('');
    try {
      const res = await apiFetch<{ lat: number; lng: number; display_name: string; approximate: boolean }>(
        `/api/maps/geocode?q=${encodeURIComponent(deliveryAddress)}&zone_id=${encodeURIComponent(zoneId)}`
      );
      setDeliveryLat(res.lat);
      setDeliveryLng(res.lng);
      setShowCheckoutMap(true);
      setGeoNotice(
        res.approximate
          ? 'Ubicación estimada según tu zona. Haz clic o arrastra el marcador amarillo para afinar tu dirección.'
          : 'Dirección ubicada en el mapa. Puedes arrastrar el marcador si deseas mayor precisión.'
      );
    } catch {
      setGeoNotice('No pudimos geocodificar automáticamente; selecciona tu punto tocando el mapa.');
      setShowCheckoutMap(true);
    } finally {
      setGeocoding(false);
    }
  };

  const handleConfirmOrderReceived = async () => {
    if (!trackedOrder) return;
    setConfirmingReceipt(true);
    const trackToken = getStoredTrackingToken(trackedOrder.order_number);
    try {
      const updated = await apiFetch<Order>(`/api/orders/${trackedOrder.id}/confirm-received`, {
        method: 'POST',
        headers: trackToken ? { 'X-Tracking-Token': trackToken } : {},
        body: JSON.stringify({
          order_number: trackedOrder.order_number,
          tracking_token: trackToken || undefined,
        }),
      });
      setTrackedOrder((prev) => (prev ? { ...prev, ...updated } : updated));
      setDriverLivePos(null);
    } catch (err: any) {
      setTrackError(err.message);
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const handleUploadProof = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setTransferProofUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError('');
    if (deliveryMode === 'domicilio' && !deliveryAddress.trim()) {
      setCheckoutError('Ingrese la dirección de entrega.');
      return;
    }
    if (paymentMethod === 'transferencia' && !transferProofUrl) {
      setCheckoutError('Adjunte la captura o comprobante de transferencia bancaria.');
      return;
    }

    setSubmittingOrder(true);
    try {
      const created = await apiFetch<Order>('/api/orders/online', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_rtn: customerRtn,
          delivery_mode: deliveryMode,
          zone_id: zoneId,
          delivery_address: deliveryAddress,
          delivery_reference: deliveryReference,
          delivery_notes: deliveryNotes,
          delivery_lat: deliveryLat,
          delivery_lng: deliveryLng,
          payment_method: paymentMethod,
          transfer_proof_url: transferProofUrl,
        }),
      });
      if (created.tracking_token) {
        try {
          sessionStorage.setItem(`lpm_track_${created.order_number.toUpperCase()}`, created.tracking_token);
        } catch {
          // ignore storage limits
        }
      }
      setCart([]);
      setCheckoutOpen(false);
      setCartOpen(false);
      setTrackInput(created.order_number);
      setView('seguimiento');
      await handleTrackSearch(created.order_number);
      onOrderCreated();
    } catch (err: any) {
      setCheckoutError(err.message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleRepeatOrder = (order: Order) => {
    const itemsToAdd: CartItem[] = [];
    for (const item of order.items || []) {
      const prod = products.find((p) => p.id === item.product_id && p.stock > 0);
      if (prod) {
        itemsToAdd.push({ product: prod, quantity: Math.min(prod.stock, item.quantity) });
      }
    }
    if (itemsToAdd.length > 0) {
      setCart(itemsToAdd);
      setCartOpen(true);
    }
  };

  const renderProductCard = (prod: Product) => {
    const qty = cardQuantities[prod.id] || 1;
    const outOfStock = prod.stock <= 0;
    const displayPrice = prod.promo_price ?? prod.sale_price;

    return (
      <article
        key={prod.id}
        className="group bg-white border border-[#202633]/12 rounded-xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md"
      >
        <button
          type="button"
          onClick={() => {
            setDetailProduct(prod);
            setDetailQty(1);
          }}
          className="relative aspect-[4/3] w-full bg-[#FFF4E5]/70 overflow-hidden text-left"
        >
          {prod.image_url ? (
            <img
              src={prod.image_url}
              alt={prod.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#FFF4E5] text-[#202633]/55 p-4 text-center">
              <ShoppingBag className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-xs font-medium">{prod.name}</span>
            </div>
          )}
        </button>

        <div className="p-5 flex-1 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-[#202633]/65">
              <span className="truncate">{prod.brand || prod.category} · {prod.presentation}</span>
              {prod.promo_discount_pct ? (
                <span className="bg-[#F9D94A] text-[#202633] px-1.5 py-0.5 rounded-sm font-bold text-[11px] shrink-0 tabular-nums">
                  -{prod.promo_discount_pct}%
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setDetailProduct(prod);
                setDetailQty(1);
              }}
              className="text-left mt-1.5 text-base font-semibold text-[#202633] hover:text-[#2054C9] transition-colors line-clamp-2"
            >
              {prod.name}
            </button>
            <p className="text-xs text-[#202633]/65 mt-1 line-clamp-2">{prod.description}</p>
          </div>

          <div className="pt-3 border-t border-[#202633]/10 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-[#202633] font-sans tabular-nums">
                  {formatCurrency(displayPrice)}
                </span>
                {prod.promo_price && (
                  <span className="text-xs text-[#202633]/45 line-through font-sans tabular-nums">
                    {formatCurrency(prod.sale_price)}
                  </span>
                )}
              </div>
              <span className={`text-xs font-semibold ${outOfStock ? 'text-red-700' : 'text-[#0A7830]'}`}>
                {outOfStock ? 'Agotado' : `Disponible (${prod.stock})`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center border border-[#202633]/15 rounded-lg bg-[#FFF4E5]/60">
                <button
                  type="button"
                  disabled={outOfStock || qty <= 1}
                  onClick={() => setCardQuantities((prev) => ({ ...prev, [prod.id]: Math.max(1, qty - 1) }))}
                  className="p-2 text-[#202633]/70 hover:text-[#202633] disabled:opacity-40"
                  aria-label="Disminuir cantidad"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="px-2.5 text-xs font-sans tabular-nums font-semibold text-[#202633]">{qty}</span>
                <button
                  type="button"
                  disabled={outOfStock || qty >= prod.stock}
                  onClick={() => setCardQuantities((prev) => ({ ...prev, [prod.id]: Math.min(prod.stock, qty + 1) }))}
                  className="p-2 text-[#202633]/70 hover:text-[#202633] disabled:opacity-40"
                  aria-label="Aumentar cantidad"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                type="button"
                disabled={outOfStock}
                onClick={() => addToCart(prod, qty)}
                className="flex-1 py-2 px-3 bg-[#2054C9] hover:bg-[#1943A3] disabled:bg-[#202633]/15 disabled:text-[#202633]/45 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                {outOfStock ? 'Sin existencias' : 'Agregar al carrito'}
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  const renderOrderTimeline = (order: Order) => {
    if (order.status === 'rechazado' || order.status === 'cancelado') {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
          <p className="font-semibold">{ORDER_STATUS_LABELS[order.status]}</p>
          {order.rejection_reason && <p className="text-xs mt-1">Motivo: {order.rejection_reason}</p>}
        </div>
      );
    }

    const steps: { key: OrderStatus; label: string }[] =
      order.delivery_mode === 'recoger'
        ? [
            { key: 'recibido', label: 'Pedido recibido' },
            { key: 'confirmado', label: 'Pedido confirmado' },
            { key: 'en_preparacion', label: 'En preparación' },
            { key: 'listo_recoger', label: 'Listo para recoger' },
            { key: 'entregado', label: 'Entregado' },
          ]
        : [
            { key: 'recibido', label: 'Pedido recibido' },
            { key: 'confirmado', label: 'Pedido confirmado' },
            { key: 'en_preparacion', label: 'En preparación' },
            { key: 'en_camino', label: 'En camino' },
            { key: 'entregado', label: 'Entregado' },
          ];

    const currentIdx = steps.findIndex((s) => s.key === order.status);

    return (
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        {steps.map((step, idx) => {
          const completed = idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <div
              key={step.key}
              className={`p-3 rounded-lg border text-xs ${
                completed
                  ? 'bg-[#13B64B]/10 border-[#13B64B]/40 text-[#202633]'
                  : 'bg-[#FFF4E5]/40 border-[#202633]/10 text-[#202633]/45'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-semibold">0{idx + 1}</span>
                {completed && <Check className="w-3.5 h-3.5 text-[#0A7830]" />}
              </div>
              <p className={`font-medium ${isCurrent ? 'text-[#0A7830] font-semibold' : ''}`}>{step.label}</p>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FFF4E5] text-[#202633]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#202633]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setView('inicio')}
            className="text-2xl tracking-wider text-[#202633] font-display whitespace-nowrap shrink-0 flex items-center gap-2.5"
          >
            <img
              src={settings.logo_url || '/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png'}
              alt={settings.business_name}
              className="w-9 h-9 rounded-lg object-cover shrink-0"
            />
            LOS PATRONES
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#202633]/75">
            <button
              type="button"
              onClick={() => {
                setView('catalogo');
              }}
              className={`hover:text-[#2054C9] transition-colors whitespace-nowrap shrink-0 ${
                view === 'catalogo' ? 'text-[#2054C9] font-semibold' : ''
              }`}
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => setView('ofertas')}
              className={`hover:text-[#2054C9] transition-colors whitespace-nowrap shrink-0 ${
                view === 'ofertas' ? 'text-[#2054C9] font-semibold' : ''
              }`}
            >
              Ofertas
            </button>
            <button
              type="button"
              onClick={() => {
                setView('seguimiento');
                if (!trackedOrder) handleTrackSearch(trackInput);
              }}
              className={`hover:text-[#2054C9] transition-colors whitespace-nowrap shrink-0 ${
                view === 'seguimiento' ? 'text-[#2054C9] font-semibold' : ''
              }`}
            >
              Seguir Pedido
            </button>
            <button
              type="button"
              onClick={() => setView('cuenta')}
              className={`hover:text-[#2054C9] transition-colors whitespace-nowrap shrink-0 ${
                view === 'cuenta' ? 'text-[#2054C9] font-semibold' : ''
              }`}
            >
              Mi Cuenta
            </button>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hover:text-[#2054C9] transition-colors whitespace-nowrap shrink-0"
            >
              Administración
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Carrito ({activeCartCount})</span>
            </button>
          </div>
        </div>

        {/* Mobile Secondary Nav */}
        <div className="md:hidden border-t border-[#202633]/10 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium text-[#202633]/75">
          <button type="button" onClick={() => setView('inicio')} className="whitespace-nowrap shrink-0">Inicio</button>
          <button type="button" onClick={() => setView('catalogo')} className="whitespace-nowrap shrink-0">Catálogo</button>
          <button type="button" onClick={() => setView('ofertas')} className="whitespace-nowrap shrink-0">Ofertas</button>
          <button type="button" onClick={() => setView('seguimiento')} className="whitespace-nowrap shrink-0">Seguir Pedido</button>
          <button type="button" onClick={() => setView('cuenta')} className="whitespace-nowrap shrink-0">Mi Cuenta</button>
          <button type="button" onClick={onOpenAdmin} className="whitespace-nowrap shrink-0 text-[#2054C9] font-semibold">Admin / POS</button>
        </div>
      </header>

      <main className="flex-1">
        {view === 'inicio' && (
          <div className="space-y-16 pb-16">
            {/* Hero Section */}
            <section className="bg-white border-b border-[#202633]/10">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                  <div className="text-xs font-medium text-[#ffffff]">
                    {settings.business_name} · {settings.address} · {settings.hours}
                  </div>
                  <h1 className="text-4xl sm:text-6xl font-display text-[#202633] text-balance leading-[0.98]">
                    Tus compras diarias de confianza, en minutos hasta tu puerta.
                  </h1>
                  <p className="text-base text-[#202633]/75 max-w-xl leading-relaxed">
                    Abarrotes esenciales, bebidas frías, lácteos frescos y artículos del hogar con precios transparentes y
                    entrega rápida a domicilio.
                  </p>

                  {/* Search Input in First Layer */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setView('catalogo');
                    }}
                    className="flex flex-col sm:flex-row gap-2.5 max-w-xl"
                  >
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-[#202633]/45 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar bebidas, café, arroz, lácteos..."
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#202633]/20 rounded-lg bg-white text-[#202633] focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-[#2054C9] hover:bg-[#1943A3] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Explorar catálogo
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-6">
                  <div className="aspect-[16/9] lg:aspect-auto lg:h-full rounded-xl overflow-hidden border border-[#202633]/10 bg-[#FFF4E5]">
                    <img
                      src={HERO_IMG}
                      alt="Interior de Los Patrones Mini Market"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Categories Strip */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-3xl text-[#202633] font-display">Categorías del mercado</h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('Todas');
                    setView('catalogo');
                  }}
                  className="text-xs font-semibold text-[#2054C9] hover:text-[#1943A3]"
                >
                  Ver todo el catálogo
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {PRODUCT_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat);
                      setView('catalogo');
                    }}
                    className="px-4 py-2 text-xs font-medium bg-white border border-[#202633]/12 text-[#202633] hover:border-[#2054C9] hover:text-[#2054C9] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </section>

            {/* Promotional Banner */}
            {promotions.length > 0 && (
              <section className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className="bg-[#F9D94A] border border-[#202633]/15 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
                  <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center space-y-4">
                    <span className="text-[21px] font-bold uppercase tracking-wider text-[#202633]/80">Promoción vigente</span>
                    <h2 className="text-[73px] text-[#202633] font-display text-balance leading-none">
                      {promotions[0].title}
                    </h2>
                    <p className="text-[16px] text-[#202633]/85 font-medium max-w-lg">{promotions[0].description}</p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setView('ofertas')}
                        className="px-5 py-2.5 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        Ver {offerProducts.length} ofertas disponibles
                      </button>
                    </div>
                  </div>
                  <div className="lg:col-span-5 min-h-[220px] bg-white">
                    <img
                      src={promotions[0].banner_image_url || PROMO_IMG}
                      alt={promotions[0].title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Featured & Bestsellers */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-8">
              <div className="flex items-end justify-between border-b border-[#202633]/12 pb-4">
                <div>
                  <h2 className="text-3xl text-[#202633] font-display">Productos destacados y más vendidos</h2>
                  <p className="text-sm text-[#202633]/70 mt-1">Selección actualizada con disponibilidad en tiempo real.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setView('catalogo')}
                  className="text-xs font-semibold text-[#2054C9] hover:text-[#1943A3] whitespace-nowrap shrink-0"
                >
                  Catálogo completo
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {(featuredProducts.length > 0 ? featuredProducts : bestsellerProducts).map(renderProductCard)}
              </div>
            </section>
          </div>
        )}

        {(view === 'catalogo' || view === 'ofertas') && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#202633]/12">
              <div>
                <h1 className="text-3xl sm:text-4xl text-[#202633] font-display">
                  {view === 'ofertas' ? 'Ofertas disponibles' : 'Catálogo de productos'}
                </h1>
                <p className="text-sm text-[#202633]/70 mt-1">
                  {filteredProducts.length} productos encontrados · Precios finales en Lempiras
                </p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-[#202633]/45 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre, marca o código..."
                  className="w-full pl-10 pr-4 py-2 text-sm border border-[#202633]/20 rounded-lg bg-white text-[#202633] focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
              <button
                type="button"
                onClick={() => setSelectedCategory('Todas')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === 'Todas'
                    ? 'bg-[#2054C9] text-white'
                    : 'bg-white border border-[#202633]/15 text-[#202633] hover:border-[#2054C9]'
                }`}
              >
                Todas
              </button>
              {PRODUCT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    selectedCategory === cat
                      ? 'bg-[#2054C9] text-white'
                      : 'bg-white border border-[#202633]/15 text-[#202633] hover:border-[#2054C9]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 ? (
              <div className="bg-white border border-[#202633]/12 rounded-xl p-12 text-center">
                <p className="text-sm text-[#202633]/70">No hay productos que coincidan con tu búsqueda.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('Todas');
                    setSearchQuery('');
                  }}
                  className="mt-4 px-4 py-2 text-xs font-semibold text-[#2054C9] bg-[#2054C9]/10 rounded-lg"
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProducts.map(renderProductCard)}
              </div>
            )}
          </div>
        )}

        {view === 'seguimiento' && (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-6">
            <div className="bg-white border border-[#202633]/12 rounded-xl p-6 sm:p-8 space-y-6">
              <div>
                <h1 className="text-3xl text-[#202633] font-display">Seguimiento del pedido</h1>
                <p className="text-sm text-[#202633]/70 mt-1">
                  Ingresa tu número de pedido para consultar su estado en tiempo real.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTrackSearch();
                }}
                className="flex flex-col sm:flex-row gap-3"
              >
                <input
                  type="text"
                  value={trackInput}
                  onChange={(e) => setTrackInput(e.target.value)}
                  placeholder="Ej. PED-2026-0143"
                  className="flex-1 px-4 py-2.5 text-sm font-mono border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#2054C9] hover:bg-[#1943A3] text-white text-sm font-semibold rounded-lg whitespace-nowrap shrink-0"
                >
                  Consultar estado
                </button>
              </form>

              {trackError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{trackError}</div>
              )}

              {trackedOrder && (
                <div className="space-y-6 pt-4 border-t border-[#202633]/12">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-xs text-[#202633]/60">Número de pedido</span>
                      <h2 className="text-xl font-bold font-mono text-[#202633]">{trackedOrder.order_number}</h2>
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="text-xs text-[#202633]/60">Estado actual</span>
                      <p className={`text-sm font-semibold ${getStatusColorClass(trackedOrder.status)}`}>
                        {ORDER_STATUS_LABELS[trackedOrder.status]}
                      </p>
                    </div>
                  </div>

                  {/* Real-time notifications (dispatched / driver near / delivered) */}
                  {trackNotifications.length > 0 && (
                    <div className="space-y-2">
                      {trackNotifications.slice(0, 3).map((notif) => (
                        <div
                          key={notif.id}
                          className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                            notif.event_type === 'driver_near'
                              ? 'bg-[#F9D94A]/45 border-[#F9D94A] text-[#202633]'
                              : notif.event_type === 'order_delivered'
                              ? 'bg-[#13B64B]/15 border-[#13B64B]/40 text-[#0A7830]'
                              : 'bg-[#2054C9]/8 border-[#2054C9]/25 text-[#202633]'
                          }`}
                        >
                          <Bell className="w-4 h-4 shrink-0 mt-0.5 text-[#2054C9]" />
                          <div>
                            <p className="font-bold">{notif.title}</p>
                            <p className="text-[#202633]/80">{notif.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {renderOrderTimeline(trackedOrder)}

                  {/* Live Delivery Tracking Map (Customer only sees assigned driver of THIS order while en_camino) */}
                  {trackedOrder.delivery_mode === 'domicilio' && trackedOrder.delivery_lat && trackedOrder.delivery_lng && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 font-bold text-[#202633]">
                          <Navigation className="w-4 h-4 text-[#2054C9]" />
                          <span>Mapa de seguimiento en tiempo real</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[#202633]/75">
                          {trackedOrder.status === 'en_camino' && driverLivePos ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#13B64B]/20 text-[#0A7830] font-bold rounded-md">
                              <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
                              Repartidor en camino · Llegada estimada: ~
                              {driverLivePos.eta_min ?? trackedRoute?.duration_min ?? trackedOrder.estimated_duration_min ?? 10} min
                            </span>
                          ) : trackedOrder.status === 'entregado' ? (
                            <span className="text-[#0A7830] font-semibold">
                              Entrega completada — seguimiento GPS finalizado
                            </span>
                          ) : (
                            <span>
                              Distancia estimada: {trackedRoute?.distance_km ?? trackedOrder.estimated_distance_km ?? '—'} km · ~
                              {trackedRoute?.duration_min ?? trackedOrder.estimated_duration_min ?? '—'} min
                            </span>
                          )}
                        </div>
                      </div>

                      <DeliveryMap
                        store={{
                          lat: trackedOrder.store?.lat ?? settings.store_lat ?? 15.612194,
                          lng: trackedOrder.store?.lng ?? settings.store_lng ?? -87.939167,
                          name: settings.business_name,
                          address: settings.address,
                        }}
                        destination={{
                          lat: trackedOrder.delivery_lat,
                          lng: trackedOrder.delivery_lng,
                          label: 'Tu dirección de entrega',
                          address: trackedOrder.delivery_address,
                        }}
                        driver={
                          trackedOrder.status === 'en_camino' && driverLivePos
                            ? {
                                lat: driverLivePos.lat,
                                lng: driverLivePos.lng,
                                name: trackedOrder.assigned_driver_name || 'Tu repartidor',
                                eta_min: driverLivePos.eta_min ?? trackedRoute?.duration_min,
                              }
                            : null
                        }
                        routeGeometry={trackedRoute?.geometry || []}
                        heightClass="h-[320px] sm:h-[380px]"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-[#FFF4E5]/60 p-4 rounded-xl border border-[#202633]/12">
                    <div className="space-y-1">
                      <p className="font-semibold text-[#202633]">Entrega y contacto</p>
                      <p className="text-[#202633]/75">{trackedOrder.customer_name} · {trackedOrder.customer_phone}</p>
                      <p className="text-[#202633]/75">
                        {trackedOrder.delivery_mode === 'domicilio'
                          ? `${trackedOrder.delivery_address} (${trackedOrder.delivery_zone_name})`
                          : 'Recoger en el establecimiento'}
                      </p>
                      {trackedOrder.assigned_driver_name && (
                        <p className="text-[#2054C9] font-semibold">Repartidor asignado: {trackedOrder.assigned_driver_name}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <p className="font-semibold text-[#202633]">Resumen de pago</p>
                        <p className="text-[#202633]/75">
                          Método: {trackedOrder.payment_method === 'transferencia' ? 'Transferencia bancaria' : 'Efectivo'}
                        </p>
                        <p className="text-[#202633] font-sans font-bold tabular-nums text-sm">
                          Total: {formatCurrency(trackedOrder.total)}
                        </p>
                      </div>

                      {(trackedOrder.status === 'en_camino' ||
                        (trackedOrder.status === 'entregado' && !trackedOrder.customer_confirmed_at)) && (
                        <button
                          type="button"
                          disabled={confirmingReceipt}
                          onClick={handleConfirmOrderReceived}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] font-bold text-xs rounded-lg disabled:opacity-50"
                        >
                          <PackageCheck className="w-4 h-4" />
                          {confirmingReceipt ? 'Confirmando...' : 'Confirmar pedido recibido'}
                        </button>
                      )}
                      {trackedOrder.customer_confirmed_at && (
                        <p className="text-[#0A7830] font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          Recepción confirmada por el cliente ({trackedOrder.customer_confirmed_at})
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'cuenta' && (
          <CustomerAccount
            user={user}
            settings={settings}
            onLoginSuccess={onLoginSuccess}
            onLogout={onLogout}
            onRepeatOrder={handleRepeatOrder}
            onTrackOrder={(num) => {
              setTrackInput(num);
              setView('seguimiento');
              handleTrackSearch(num);
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-[#202633]/12 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-8 text-xs text-[#202633]/75">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <img
                src={settings.logo_url || '/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png'}
                alt={settings.business_name}
                className="w-7 h-7 rounded-md object-cover shrink-0"
              />
              <p className="text-xl text-[#202633] font-display tracking-wider">{settings.business_name}</p>
            </div>
            <p className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#2054C9]" />
              <span>{settings.address}</span>
            </p>
            <p className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 shrink-0 text-[#2054C9]" />
              <a
                href={`tel:${settings.phones.replace(/[^+\d]/g, '')}`}
                className="font-mono hover:text-[#2054C9] hover:underline"
              >
                {settings.phones}
              </a>
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-[#202633]">Horarios y cobertura</p>
            <p className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 shrink-0 text-[#2054C9]" />
              <span>{settings.hours}</span>
            </p>
            <p>Pedido mínimo a domicilio: {formatCurrency(settings.min_order_amount)}</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-[#202633]">Sistema centralizado</p>
            <p>Inventario sincronizado en tiempo real entre tienda física y pedidos en línea.</p>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="text-[#2054C9] hover:text-[#1943A3] font-semibold underline underline-offset-4"
            >
              Ingresar al Sistema Central de Administración y POS
            </button>
          </div>
        </div>
      </footer>

      {/* Product Detail Modal */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/55 p-4">
          <div className="bg-white border border-[#202633]/12 rounded-xl w-full max-w-2xl overflow-hidden grid grid-cols-1 sm:grid-cols-2">
            <div className="aspect-square sm:aspect-auto bg-[#FFF4E5]">
              <img
                src={detailProduct.image_url}
                alt={detailProduct.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#202633]/65 font-medium">
                    {detailProduct.category} · {detailProduct.brand}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDetailProduct(null)}
                    className="p-1 text-[#202633]/50 hover:text-[#202633]"
                    aria-label="Cerrar detalle"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="text-xl font-bold text-[#202633] font-sans mt-2">{detailProduct.name}</h3>
                <p className="text-xs text-[#202633]/65 mt-1">Presentación: {detailProduct.presentation}</p>
                <p className="text-sm text-[#202633]/75 mt-4 leading-relaxed">{detailProduct.description}</p>
              </div>

              <div className="pt-4 border-t border-[#202633]/12 space-y-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-sans tabular-nums text-[#202633]">
                    {formatCurrency(detailProduct.promo_price ?? detailProduct.sale_price)}
                  </span>
                  <span className={`text-xs font-semibold ${detailProduct.stock > 0 ? 'text-[#0A7830]' : 'text-red-700'}`}>
                    {detailProduct.stock > 0 ? `${detailProduct.stock} disponibles` : 'Agotado'}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-[#202633]/20 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                      className="p-2.5 text-[#202633]/70"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="px-3 text-sm font-sans font-semibold tabular-nums">{detailQty}</span>
                    <button
                      type="button"
                      onClick={() => setDetailQty((q) => Math.min(detailProduct.stock, q + 1))}
                      className="p-2.5 text-[#202633]/70"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={detailProduct.stock <= 0}
                    onClick={() => {
                      addToCart(detailProduct, detailQty);
                      setDetailProduct(null);
                    }}
                    className="flex-1 py-2.5 px-4 bg-[#2054C9] hover:bg-[#1943A3] disabled:bg-[#202633]/20 text-white text-sm font-semibold rounded-lg"
                  >
                    Agregar al carrito
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Cart & Checkout Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#202633]/40">
          <div className="w-full max-w-md bg-white h-full flex flex-col border-l border-[#202633]/12 shadow-xl">
            <div className="px-6 py-4 border-b border-[#202633]/12 flex items-center justify-between">
              <h3 className="text-2xl text-[#202633] font-display">
                {checkoutOpen ? 'Finalizar pedido' : `Tu carrito (${activeCartCount})`}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(false);
                }}
                className="p-1.5 text-[#202633]/60 hover:text-[#202633] rounded-lg hover:bg-[#FFF4E5]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!checkoutOpen ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {cart.length === 0 ? (
                    <div className="text-center py-16 space-y-3">
                      <ShoppingBag className="w-10 h-10 text-[#202633]/25 mx-auto" />
                      <p className="text-sm text-[#202633]/60">Tu carrito de compras está vacío.</p>
                    </div>
                  ) : (
                    cart.map((item) => {
                      const price = item.product.promo_price ?? item.product.sale_price;
                      return (
                        <div key={item.product.id} className="flex gap-3 pb-4 border-b border-[#202633]/10">
                          <img
                            src={item.product.image_url}
                            alt={item.product.name}
                            referrerPolicy="no-referrer"
                            className="w-16 h-16 rounded-lg object-cover bg-[#FFF4E5] shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#202633] truncate">{item.product.name}</p>
                            <p className="text-xs text-[#202633]/70 font-sans tabular-nums">
                              {formatCurrency(price)} × {item.quantity} = {formatCurrency(price * item.quantity)}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                type="button"
                                onClick={() => updateCartQty(item.product.id, -1)}
                                className="p-1 border border-[#202633]/15 rounded hover:bg-[#FFF4E5]"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-sans font-semibold tabular-nums px-1">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateCartQty(item.product.id, 1)}
                                className="p-1 border border-[#202633]/15 rounded hover:bg-[#FFF4E5]"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeFromCart(item.product.id)}
                                className="ml-auto text-[#202633]/45 hover:text-red-700 p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="p-6 border-t border-[#202633]/12 bg-[#FFF4E5]/60 space-y-4">
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between text-[#202633]/75">
                        <span>Subtotal</span>
                        <span className="font-sans font-medium tabular-nums">{formatCurrency(cartTotals.subtotal)}</span>
                      </div>
                      {cartTotals.discounts > 0 && (
                        <div className="flex justify-between text-[#0A7830] font-semibold">
                          <span>Descuentos aplicados</span>
                          <span className="font-sans tabular-nums">-{formatCurrency(cartTotals.discounts)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[#202633]/75">
                        <span>Costo de envío ({deliveryMode === 'domicilio' ? 'estimado' : 'tienda'})</span>
                        <span className="font-sans font-medium tabular-nums">{formatCurrency(cartTotals.deliveryFee)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-[#202633] pt-2 border-t border-[#202633]/12">
                        <span>Total estimado</span>
                        <span className="font-sans tabular-nums">{formatCurrency(cartTotals.total)}</span>
                      </div>
                    </div>

                    {deliveryMode === 'domicilio' && cartTotals.netSubtotal < settings.min_order_amount && (
                      <div className="flex items-start gap-2 text-xs text-[#202633] bg-[#F9D94A]/40 border border-[#F9D94A] p-2.5 rounded-lg">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#202633]" />
                        <span>
                          Pedido mínimo para envío a domicilio: {formatCurrency(settings.min_order_amount)} (puedes elegir
                          recoger en tienda sin mínimo).
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (user && !customerName) setCustomerName(user.name);
                        if (user && !customerPhone) setCustomerPhone(user.phone);
                        setCheckoutOpen(true);
                      }}
                      className="w-full py-3 px-4 bg-[#2054C9] hover:bg-[#1943A3] text-white text-sm font-semibold rounded-lg"
                    >
                      Continuar al pedido
                    </button>
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={handleCheckoutSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
                <button
                  type="button"
                  onClick={() => setCheckoutOpen(false)}
                  className="text-xs font-semibold text-[#2054C9] hover:underline"
                >
                  Volver al carrito
                </button>

                <div>
                  <label className="block text-xs font-semibold text-[#202633] mb-2">Modalidad de entrega</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDeliveryMode('domicilio')}
                      className={`p-3 border rounded-lg text-left text-xs transition-colors ${
                        deliveryMode === 'domicilio' ? 'border-[#2054C9] bg-[#2054C9]/8 text-[#2054C9]' : 'border-[#202633]/15'
                      }`}
                    >
                      <Truck className="w-4 h-4 mb-1" />
                      <div className="font-semibold">Envío a domicilio</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryMode('recoger')}
                      className={`p-3 border rounded-lg text-left text-xs transition-colors ${
                        deliveryMode === 'recoger' ? 'border-[#2054C9] bg-[#2054C9]/8 text-[#2054C9]' : 'border-[#202633]/15'
                      }`}
                    >
                      <Store className="w-4 h-4 mb-1" />
                      <div className="font-semibold">Recoger en tienda</div>
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#202633] mb-1">Nombre completo *</label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-[#202633] mb-1">Teléfono *</label>
                      <input
                        type="text"
                        required
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+504 9999-9999"
                        className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                {deliveryMode === 'domicilio' && (
                  <div className="space-y-3 pt-2 border-t border-[#202633]/10">
                    <div>
                      <label className="block text-xs font-medium text-[#202633] mb-1">Zona de entrega</label>
                      <select
                        value={zoneId}
                        onChange={(e) => setZoneId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg bg-white"
                      >
                        {settings.delivery_zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name} — {formatCurrency(z.fee)} ({z.eta})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-[#202633]">Dirección de entrega *</label>
                        <button
                          type="button"
                          disabled={geocoding}
                          onClick={handleGeocodeCheckoutAddress}
                          className="text-[11px] font-semibold text-[#2054C9] hover:underline inline-flex items-center gap-1"
                        >
                          <MapPin className="w-3 h-3" />
                          {geocoding ? 'Ubicando...' : 'Ubicar en mapa'}
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="Colonia, calle, número de casa..."
                        className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
                      />
                    </div>

                    {showCheckoutMap && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-[#202633]/70">
                          {geoNotice || 'Toca el mapa o arrastra el pin amarillo para marcar tu punto exacto de entrega.'}
                        </p>
                        <DeliveryMap
                          store={{
                            lat: settings.store_lat ?? 15.612194,
                            lng: settings.store_lng ?? -87.939167,
                            name: settings.business_name,
                            address: settings.address,
                          }}
                          destination={
                            deliveryLat && deliveryLng
                              ? { lat: deliveryLat, lng: deliveryLng, label: 'Tu punto de entrega', address: deliveryAddress }
                              : null
                          }
                          interactivePicker
                          onPickLocation={(lat, lng) => {
                            setDeliveryLat(lat);
                            setDeliveryLng(lng);
                          }}
                          heightClass="h-48"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-[#202633] mb-1">Referencias de ubicación</label>
                      <input
                        type="text"
                        value={deliveryReference}
                        onChange={(e) => setDeliveryReference(e.target.value)}
                        placeholder="Color de portón, punto cercano..."
                        className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#202633] mb-1">Indicaciones adicionales</label>
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Llamar al llegar, billete de cambio..."
                    className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
                  />
                </div>

                <div className="pt-2 border-t border-[#202633]/10 space-y-3">
                  <label className="block text-xs font-semibold text-[#202633]">Método de pago</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('efectivo')}
                      className={`p-2.5 border rounded-lg text-xs font-semibold ${
                        paymentMethod === 'efectivo' ? 'border-[#2054C9] bg-[#2054C9]/8 text-[#2054C9]' : 'border-[#202633]/15'
                      }`}
                    >
                      Efectivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('transferencia')}
                      className={`p-2.5 border rounded-lg text-xs font-semibold ${
                        paymentMethod === 'transferencia' ? 'border-[#2054C9] bg-[#2054C9]/8 text-[#2054C9]' : 'border-[#202633]/15'
                      }`}
                    >
                      Transferencia bancaria
                    </button>
                  </div>

                  {paymentMethod === 'transferencia' && (
                    <div className="p-3 bg-[#FFF4E5]/60 border border-[#202633]/12 rounded-lg space-y-2.5 text-xs">
                      <p className="font-semibold text-[#202633]">Cuentas autorizadas para transferencia:</p>
                      {settings.bank_accounts.map((b) => (
                        <div key={b.id} className="pb-1.5 border-b border-[#202633]/10 last:border-none">
                          <span className="font-medium text-[#202633]">{b.bank}</span> ·{' '}
                          <span className="font-mono text-[#202633]">{b.account_number}</span>
                          <div className="text-[11px] text-[#202633]/65">
                            {b.account_type} · {b.holder}
                          </div>
                        </div>
                      ))}

                      <label className="block pt-1">
                        <span className="block font-medium text-[#202633] mb-1">Adjuntar comprobante de transferencia *</span>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#202633]/20 rounded-lg cursor-pointer hover:bg-[#FFF4E5]">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Subir imagen</span>
                            <input type="file" accept="image/*" onChange={handleUploadProof} className="hidden" />
                          </label>
                          {transferProofUrl && <span className="text-[#0A7830] font-semibold">Comprobante adjunto</span>}
                        </div>
                      </label>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-[#FFF4E5]/70 rounded-lg border border-[#202633]/12 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>Subtotal neto</span>
                    <span className="font-sans font-medium tabular-nums">{formatCurrency(cartTotals.netSubtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Envío</span>
                    <span className="font-sans font-medium tabular-nums">{formatCurrency(cartTotals.deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-sm text-[#202633] pt-1 border-t border-[#202633]/12">
                    <span>Total a pagar</span>
                    <span className="font-sans tabular-nums">{formatCurrency(cartTotals.total)}</span>
                  </div>
                </div>

                {checkoutError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-2.5 rounded-lg">{checkoutError}</p>
                )}

                <button
                  type="submit"
                  disabled={submittingOrder}
                  className="w-full py-3 px-4 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] text-sm font-bold rounded-lg disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  <PackageCheck className="w-4 h-4" />
                  {submittingOrder ? 'Enviando pedido...' : 'Confirmar y enviar pedido'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      <HelpAssistant
        mode="store"
        currentScreen={view}
        userRole={user?.role}
        userName={user?.name}
        cartCount={activeCartCount}
        onNavigate={(target) => {
          if (target === 'carrito') {
            setCartOpen(true);
            return;
          }
          if (['inicio', 'catalogo', 'ofertas', 'seguimiento', 'cuenta'].includes(target)) {
            setCheckoutOpen(false);
            setCartOpen(false);
            setView(target as typeof view);
          }
        }}
      />
    </div>
  );
};
