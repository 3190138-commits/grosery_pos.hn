import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Camera, Search, Trash2, Plus, Minus, Receipt, Printer, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { BusinessSettings, CashSession, Customer, Invoice, Order, PaymentMethod, Product, ProductBarcode } from '../../types';
import { apiFetch, formatCurrency } from '../../lib/api';
import { playScanBeep } from '../../lib/scannerAudio';
import { InvoiceModal } from '../InvoiceModal';
import { CameraBarcodeModal } from '../CameraBarcodeModal';

interface PosTerminalProps {
  settings: BusinessSettings;
  products: Product[];
  onSaleCompleted: () => void;
  onNavigateCash: () => void;
}

interface PosCartItem {
  product: Product;
  barcodeId?: number;
  presentationLabel?: string;
  unitPrice: number;
  basePrice: number;
  quantity: number;
}

export const PosTerminal: React.FC<PosTerminalProps> = ({ settings, products, onSaleCompleted, onNavigateCash }) => {
  const scannerCfg = settings.scanner_config || {
    hid_enabled: true,
    suffix_key: 'Enter',
    auto_focus_pos: true,
    beep_on_scan: true,
    camera_enabled: true,
    preferred_camera_facing: 'environment',
    auto_increment_qty: true,
  };

  const [search, setSearch] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [extraDiscount, setExtraDiscount] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState('Consumidor Final');
  const [customerRtn, setCustomerRtn] = useState('00000000000000');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [transferRef, setTransferRef] = useState('');
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [recentPosOrders, setRecentPosOrders] = useState<Order[]>([]);
  const [posError, setPosError] = useState('');
  const [unregisteredCode, setUnregisteredCode] = useState<string | null>(null);
  const [lastScannedBanner, setLastScannedBanner] = useState<{
    name: string;
    price: number;
    stock: number;
    code: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issuedInvoice, setIssuedInvoice] = useState<Invoice | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadPosContext = async () => {
    try {
      const [cashRes, custRes, ordersRes] = await Promise.all([
        apiFetch<{ session: CashSession | null }>('/api/cash/current'),
        apiFetch<Customer[]>('/api/customers'),
        apiFetch<Order[]>('/api/orders?channel=pos'),
      ]);
      setCashSession(cashRes.session);
      setCustomers(custRes);
      setRecentPosOrders(ordersRes.slice(0, 15));
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    loadPosContext();
    if (scannerCfg.auto_focus_pos) {
      barcodeRef.current?.focus();
    }
  }, []);

  const addProductToCart = (prod: Product, matchedBc?: ProductBarcode | null, scannedCode?: string) => {
    if (prod.stock <= 0) {
      if (scannerCfg.beep_on_scan) playScanBeep('error');
      setPosError(`"${prod.name}" está agotado (0 existencias).`);
      return;
    }
    setPosError('');
    setUnregisteredCode(null);

    const hasOverride = matchedBc?.price_override !== null && matchedBc?.price_override !== undefined;
    const basePrice = hasOverride ? Number(matchedBc!.price_override) : prod.sale_price;
    const unitPrice = hasOverride ? Number(matchedBc!.price_override) : (prod.promo_price ?? prod.sale_price);
    const presLabel = matchedBc?.presentation_label || prod.presentation;

    setLastScannedBanner({
      name: prod.name,
      price: unitPrice,
      stock: prod.stock,
      code: scannedCode || matchedBc?.code || prod.barcode || prod.internal_code,
    });

    if (scannerCfg.beep_on_scan) playScanBeep('success');

    setCart((prev) => {
      const existing = prev.find(
        (i) => i.product.id === prod.id && (i.barcodeId || 0) === (matchedBc?.id || 0)
      );
      if (existing) {
        if (!scannerCfg.auto_increment_qty) return prev;
        if (existing.quantity >= prod.stock) {
          setPosError(`Stock máximo alcanzado para ${prod.name} (${prod.stock} disponibles).`);
          return prev;
        }
        return prev.map((i) =>
          i.product.id === prod.id && (i.barcodeId || 0) === (matchedBc?.id || 0)
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [
        ...prev,
        {
          product: prod,
          barcodeId: matchedBc?.id,
          presentationLabel: presLabel,
          unitPrice,
          basePrice,
          quantity: 1,
        },
      ];
    });
  };

  const processScannedCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setPosError('');
    setUnregisteredCode(null);

    // First try local instant lookup across product_barcodes + barcode + internal_code
    const lower = code.toLowerCase();
    for (const p of products) {
      if (p.is_active !== 1) continue;
      const matchedBc = (p.barcodes || []).find((b) => b.code.toLowerCase() === lower);
      if (matchedBc || p.barcode.toLowerCase() === lower || p.internal_code.toLowerCase() === lower) {
        addProductToCart(p, matchedBc || null, code);
        setBarcodeInput('');
        return;
      }
    }

    // Fallback to backend lookup in case catalog updated
    try {
      const res = await apiFetch<{ product: Product; matched_barcode: ProductBarcode | null }>(
        `/api/barcodes/lookup/${encodeURIComponent(code)}`
      );
      if (res.product) {
        addProductToCart(res.product, res.matched_barcode, code);
        setBarcodeInput('');
        return;
      }
    } catch {
      // Not registered
    }

    if (scannerCfg.beep_on_scan) playScanBeep('error');
    setLastScannedBanner(null);
    setUnregisteredCode(code);
    setBarcodeInput('');
  };

  // Global USB / Wireless HID keyboard-wedge scanner listener
  useEffect(() => {
    if (!scannerCfg.hid_enabled || showHistory || cameraOpen || issuedInvoice) return;

    let buffer = '';
    let lastTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingInOtherField =
        target &&
        target !== barcodeRef.current &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (isTypingInOtherField) return;

      const now = Date.now();
      if (now - lastTime > 120) {
        buffer = '';
      }
      lastTime = now;

      if (e.key === scannerCfg.suffix_key || e.key === 'Enter') {
        if (buffer.length >= 3 && target !== barcodeRef.current) {
          e.preventDefault();
          processScannedCode(buffer);
          buffer = '';
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scannerCfg.hid_enabled, scannerCfg.suffix_key, products, showHistory, cameraOpen, issuedInvoice]);

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processScannedCode(barcodeInput);
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.is_active === 1)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.internal_code.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          (p.barcodes || []).some((b) => b.code.toLowerCase().includes(q))
      )
      .slice(0, 18);
  }, [products, search]);

  const totals = useMemo(() => {
    let subtotalBase = 0;
    let promoDiscount = 0;
    let taxTotal = 0;
    for (const item of cart) {
      const lineBase = item.basePrice * item.quantity;
      const lineEffective = item.unitPrice * item.quantity;
      subtotalBase += lineBase;
      promoDiscount += Math.max(0, lineBase - lineEffective);
      taxTotal = 0;
    }
    const netBeforeExtra = subtotalBase - promoDiscount;
    const total = Math.max(0, netBeforeExtra - extraDiscount);
    const receivedNum = Number(cashReceived || 0);
    const change = paymentMethod === 'efectivo' && receivedNum >= total ? receivedNum - total : 0;
    return { subtotalBase, promoDiscount, taxTotal, total, change };
  }, [cart, extraDiscount, cashReceived, paymentMethod]);

  const handleSelectCustomer = (idStr: string) => {
    setSelectedCustomerId(idStr);
    if (!idStr) {
      setCustomerName('Consumidor Final');
      setCustomerRtn('00000000000000');
      return;
    }
    const cust = customers.find((c) => String(c.id) === idStr);
    if (cust) {
      setCustomerName(cust.razon_social || cust.name);
      setCustomerRtn(cust.rtn || '00000000000000');
    }
  };

  const handleCompleteSale = async () => {
    setPosError('');
    if (cart.length === 0) {
      setPosError('Agregue productos para finalizar la venta.');
      return;
    }
    if (paymentMethod === 'efectivo' && Number(cashReceived || 0) < totals.total) {
      setPosError('El efectivo recibido debe ser igual o mayor al total.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ order: Order; invoice: Invoice }>('/api/orders/pos', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((c) => ({
            product_id: c.product.id,
            barcode_id: c.barcodeId,
            quantity: c.quantity,
          })),
          customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
          customer_name: customerName,
          customer_rtn: customerRtn,
          extra_discount: extraDiscount,
          payment_method: paymentMethod,
          cash_received: paymentMethod === 'efectivo' ? Number(cashReceived || totals.total) : 0,
          transfer_reference: transferRef,
        }),
      });
      setCart([]);
      setExtraDiscount(0);
      setCashReceived('');
      setTransferRef('');
      setLastScannedBanner(null);
      setIssuedInvoice({ ...res.invoice, items: res.order.items });
      onSaleCompleted();
      loadPosContext();
    } catch (err: any) {
      setPosError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openInvoiceById = async (invoiceId: number) => {
    const allInvoices = await apiFetch<Invoice[]>('/api/invoices');
    const found = allInvoices.find((i) => i.id === invoiceId);
    if (found) setIssuedInvoice(found);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Punto de Venta Presencial (POS)</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            {cashSession
              ? `Caja abierta por ${cashSession.opened_by_name} · Fondo inicial ${formatCurrency(cashSession.opening_amount)}`
              : 'Caja cerrada — realice la apertura de caja para facturar'}
            {' · '}
            {scannerCfg.hid_enabled ? `Escáner USB/HID activo (${scannerCfg.suffix_key})` : 'Escáner manual'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!cashSession && (
            <button
              type="button"
              onClick={onNavigateCash}
              className="px-3.5 py-2 text-xs font-bold bg-[#F9D94A] hover:bg-[#F2CE30] text-[#202633] rounded-lg whitespace-nowrap shrink-0"
            >
              Abrir caja ahora
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHistory((h) => !h)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg whitespace-nowrap shrink-0"
          >
            <Receipt className="w-3.5 h-3.5" />
            {showHistory ? 'Volver al terminal' : `Ventas recientes (${recentPosOrders.length})`}
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                <th className="py-3 px-4 font-semibold">N.º Venta</th>
                <th className="py-3 px-4 font-semibold">Fecha</th>
                <th className="py-3 px-4 font-semibold">Cliente</th>
                <th className="py-3 px-4 font-semibold">Pago</th>
                <th className="py-3 px-4 font-semibold text-right">Total</th>
                <th className="py-3 px-4 font-semibold text-right">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {recentPosOrders.map((ord) => (
                <tr key={ord.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                  <td className="py-3 px-4 font-mono font-medium text-[#202633]">{ord.order_number}</td>
                  <td className="py-3 px-4 font-mono text-[#202633]/65">{ord.created_at}</td>
                  <td className="py-3 px-4 text-[#202633]">{ord.customer_name}</td>
                  <td className="py-3 px-4 text-[#202633]/70">
                    {ord.payment_method === 'transferencia' ? 'Transferencia' : 'Efectivo'}
                  </td>
                  <td className="py-3 px-4 text-right font-sans tabular-nums font-bold text-[#202633]">
                    {formatCurrency(ord.total)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {ord.invoice_id && (
                      <button
                        type="button"
                        onClick={() => openInvoiceById(ord.invoice_id!)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#2054C9] bg-[#2054C9]/10 hover:bg-[#2054C9]/15 rounded-md whitespace-nowrap"
                      >
                        <Printer className="w-3 h-3" />
                        Reimprimir {ord.invoice_number}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Scanner + Camera + Search + Quick Product Grid */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white border border-[#202633]/12 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <form onSubmit={handleBarcodeSubmit} className="relative flex-1">
                  <Barcode className="w-4 h-4 text-[#2054C9] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    ref={barcodeRef}
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab' && scannerCfg.suffix_key === 'Tab' && barcodeInput.trim()) {
                        e.preventDefault();
                        processScannedCode(barcodeInput);
                      }
                    }}
                    placeholder="Escanear código de barras o ingresar código interno + Enter"
                    className="w-full pl-10 pr-24 py-2.5 text-xs font-mono border border-[#202633]/20 rounded-lg bg-white text-[#202633] focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                  />
                  <button
                    type="submit"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-[#2054C9] hover:bg-[#1943A3] text-white text-[11px] font-semibold rounded"
                  >
                    Agregar
                  </button>
                </form>

                {scannerCfg.camera_enabled && (
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-[#202633] hover:bg-[#202633]/90 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                    Cámara
                  </button>
                )}
              </div>

              {lastScannedBanner && (
                <div className="flex items-center justify-between px-3 py-2 bg-[#13B64B]/12 border border-[#13B64B]/30 rounded-lg text-xs text-[#202633]">
                  <div className="truncate pr-2">
                    <span className="font-bold text-[#0A7830]">Escaneado:</span> {lastScannedBanner.name}{' '}
                    <span className="font-mono text-[#0A7830]">({lastScannedBanner.code})</span>
                  </div>
                  <div className="font-sans font-bold tabular-nums shrink-0 text-[#0A7830]">
                    {formatCurrency(lastScannedBanner.price)} · Disp: {lastScannedBanner.stock}
                  </div>
                </div>
              )}

              {unregisteredCode && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-700" />
                    <span>
                      Código <span className="font-mono font-bold">{unregisteredCode}</span> no está registrado en el catálogo.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUnregisteredCode(null);
                      searchRef.current?.focus();
                    }}
                    className="px-2.5 py-1 bg-white border border-red-300 text-red-800 rounded font-semibold shrink-0 self-start sm:self-auto"
                  >
                    Buscar manualmente
                  </button>
                </div>
              )}

              <div className="relative">
                <Search className="w-4 h-4 text-[#202633]/45 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Búsqueda manual (productos sin código, nombre, SKU o código adicional)..."
                  className="w-full pl-10 pr-3 py-2 text-xs border border-[#202633]/15 rounded-lg bg-[#FFF4E5]/45 text-[#202633] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredProducts.map((prod) => {
                const price = prod.promo_price ?? prod.sale_price;
                return (
                  <button
                    key={prod.id}
                    type="button"
                    disabled={prod.stock <= 0}
                    onClick={() => addProductToCart(prod)}
                    className="bg-white border border-[#202633]/12 hover:border-[#2054C9] disabled:opacity-50 rounded-xl p-3 text-left transition-colors flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-[#202633]/55 font-mono">
                        <span>{prod.internal_code}</span>
                        <span className={prod.stock <= prod.min_stock ? 'text-[#8A6D00] font-semibold' : 'text-[#0A7830] font-semibold'}>
                          Disp: {prod.stock}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-[#202633] mt-1 line-clamp-2">{prod.name}</p>
                      {prod.barcode && (
                        <p className="text-[10px] font-mono text-[#202633]/45 mt-0.5 truncate">{prod.barcode}</p>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between pt-2 border-t border-[#202633]/8">
                      <span className="text-sm font-bold font-sans tabular-nums text-[#2054C9]">
                        {formatCurrency(price)}
                      </span>
                      <span className="text-[11px] text-[#202633]/55 truncate max-w-[90px]">{prod.presentation}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Current Ticket & Checkout */}
          <div className="lg:col-span-5 bg-white border border-[#202633]/12 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#202633]/12">
              <h3 className="text-sm font-bold text-[#202633] font-sans">Ticket de venta actual</h3>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-semibold text-red-700 hover:underline"
                >
                  Vaciar
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="text-xs text-[#202633]/55 py-8 text-center">
                  Escanea un código de barras o selecciona productos manualmente para iniciar la venta.
                </p>
              ) : (
                cart.map((item) => (
                  <div
                    key={`${item.product.id}-${item.barcodeId || 0}`}
                    className="flex items-center justify-between gap-2 py-2 border-b border-[#202633]/8 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#202633] truncate">
                        {item.product.name}
                        {item.presentationLabel && item.presentationLabel !== item.product.presentation
                          ? ` (${item.presentationLabel})`
                          : ''}
                      </p>
                      <p className="text-[11px] text-[#202633]/60 font-sans tabular-nums">
                        {formatCurrency(item.unitPrice)} c/u · Disp: {item.product.stock}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setCart((prev) =>
                            prev
                              .map((c) =>
                                c.product.id === item.product.id && (c.barcodeId || 0) === (item.barcodeId || 0)
                                  ? { ...c, quantity: c.quantity - 1 }
                                  : c
                              )
                              .filter((c) => c.quantity > 0)
                          )
                        }
                        className="p-1 border border-[#202633]/15 rounded hover:bg-[#FFF4E5]"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-sans tabular-nums font-bold text-[#202633]">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.quantity >= item.product.stock) return;
                          setCart((prev) =>
                            prev.map((c) =>
                              c.product.id === item.product.id && (c.barcodeId || 0) === (item.barcodeId || 0)
                                ? { ...c, quantity: c.quantity + 1 }
                                : c
                            )
                          );
                        }}
                        className="p-1 border border-[#202633]/15 rounded hover:bg-[#FFF4E5]"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="w-20 text-right font-sans tabular-nums font-bold text-[#202633] shrink-0">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCart((prev) =>
                          prev.filter(
                            (c) => !(c.product.id === item.product.id && (c.barcodeId || 0) === (item.barcodeId || 0))
                          )
                        )
                      }
                      className="text-[#202633]/40 hover:text-red-700 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Customer Info */}
            <div className="pt-3 border-t border-[#202633]/12 space-y-2.5 text-xs">
              <div>
                <label className="block text-[#202633]/75 font-semibold mb-1">Cliente registrado</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => handleSelectCustomer(e.target.value)}
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  <option value="">Consumidor Final</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nombre del cliente en comprobante"
                  className="w-full px-3 py-1.5 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
            </div>

            {/* Totals & Extra Discount */}
            <div className="p-3 bg-[#FFF4E5]/60 border border-[#202633]/12 rounded-lg space-y-1.5 text-xs">
              <div className="flex justify-between text-[#202633]/70">
                <span>Subtotal bruto</span>
                <span className="font-sans tabular-nums font-medium">{formatCurrency(totals.subtotalBase)}</span>
              </div>
              {totals.promoDiscount > 0 && (
                <div className="flex justify-between text-[#0A7830] font-semibold">
                  <span>Descuentos por promoción</span>
                  <span className="font-sans tabular-nums">-{formatCurrency(totals.promoDiscount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-[#202633]/70">
                <span>Descuento autorizado (L.)</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={extraDiscount}
                  onChange={(e) => setExtraDiscount(Math.max(0, Number(e.target.value)))}
                  className="w-24 px-2 py-1 text-right font-sans tabular-nums font-semibold border border-[#202633]/20 rounded bg-white text-[#202633]"
                />
              </div>
              <div className="flex justify-between text-base font-bold text-[#202633] pt-2 border-t border-[#202633]/12">
                <span>Total a cobrar</span>
                <span className="font-sans tabular-nums text-[#2054C9]">{formatCurrency(totals.total)}</span>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('efectivo')}
                  className={`py-2 px-3 border rounded-lg font-semibold ${
                    paymentMethod === 'efectivo'
                      ? 'border-[#2054C9] bg-[#2054C9]/10 text-[#2054C9]'
                      : 'border-[#202633]/15 text-[#202633]/75'
                  }`}
                >
                  Efectivo
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('transferencia')}
                  className={`py-2 px-3 border rounded-lg font-semibold ${
                    paymentMethod === 'transferencia'
                      ? 'border-[#2054C9] bg-[#2054C9]/10 text-[#2054C9]'
                      : 'border-[#202633]/15 text-[#202633]/75'
                  }`}
                >
                  Transferencia
                </button>
              </div>

              {paymentMethod === 'efectivo' ? (
                <div className="grid grid-cols-2 gap-3 items-center bg-[#FFF4E5]/60 p-3 rounded-lg border border-[#202633]/12">
                  <div>
                    <label className="block text-[11px] font-medium text-[#202633]/70 mb-1">Efectivo recibido (L.)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={totals.total.toFixed(2)}
                      className="w-full px-2.5 py-1.5 font-sans tabular-nums font-bold text-sm border border-[#202633]/20 rounded bg-white text-[#202633]"
                    />
                  </div>
                  <div className="text-right">
                    <span className="block text-[11px] font-medium text-[#202633]/70">Cambio a entregar</span>
                    <span className="text-lg font-bold font-sans tabular-nums text-[#0A7830]">
                      {formatCurrency(totals.change)}
                    </span>
                  </div>
                </div>
              ) : (
                <input
                  type="text"
                  value={transferRef}
                  onChange={(e) => setTransferRef(e.target.value)}
                  placeholder="N.º de referencia o banco de transferencia"
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              )}
            </div>

            {posError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{posError}</div>
            )}

            <button
              type="button"
              disabled={submitting || !cashSession || cart.length === 0}
              onClick={handleCompleteSale}
              className="w-full py-3 px-4 bg-[#13B64B] hover:bg-[#10A041] disabled:bg-[#202633]/10 disabled:text-[#202633]/40 text-[#202633] text-sm font-bold rounded-lg inline-flex items-center justify-center gap-2 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Procesando venta...' : 'Finalizar venta y emitir comprobante'}
            </button>
          </div>
        </div>
      )}

      {cameraOpen && (
        <CameraBarcodeModal
          preferredFacing={scannerCfg.preferred_camera_facing}
          title="Escanear producto para venta POS"
          onDetected={(code) => {
            setCameraOpen(false);
            processScannedCode(code);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {issuedInvoice && (
        <InvoiceModal invoice={issuedInvoice} defaultThermal onClose={() => setIssuedInvoice(null)} />
      )}
    </div>
  );
};
