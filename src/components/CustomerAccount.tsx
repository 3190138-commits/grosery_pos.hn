import React, { useEffect, useState } from 'react';
import { RefreshCw, FileText, MapPin, Plus, Trash2, Check, LogOut } from 'lucide-react';
import type { BusinessSettings, Customer, CustomerAddress, Invoice, Order, UserAccount } from '../types';
import { apiFetch, formatCurrency, ORDER_STATUS_LABELS, getStatusColorClass, downloadInvoicePDF } from '../lib/api';
import { InvoiceModal } from './InvoiceModal';

interface CustomerAccountProps {
  user: UserAccount | null;
  settings: BusinessSettings;
  onLoginSuccess: (token: string, user: UserAccount) => void;
  onLogout: () => void;
  onRepeatOrder: (order: Order) => void;
  onTrackOrder: (orderNumber: string) => void;
}

export const CustomerAccount: React.FC<CustomerAccountProps> = ({
  user,
  settings,
  onLoginSuccess,
  onLogout,
  onRepeatOrder,
  onTrackOrder,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('cliente@correo.hn');
  const [password, setPassword] = useState('123456');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [rtn, setRtn] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'invoices' | 'profile'>('orders');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [saveMsg, setSaveMsg] = useState('');

  // Profile form state
  const [profName, setProfName] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profRtn, setProfRtn] = useState('');
  const [profRazon, setProfRazon] = useState('');
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [newAddrText, setNewAddrText] = useState('');
  const [newAddrRef, setNewAddrRef] = useState('');
  const [newAddrZone, setNewAddrZone] = useState(settings.delivery_zones[0]?.id || 'centro');

  const loadAccount = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ customer: Customer; orders: Order[]; invoices: Invoice[] }>('/api/customers/my-account');
      setCustomer(data.customer);
      setOrders(data.orders);
      setInvoices(data.invoices);
      setProfName(data.customer.name);
      setProfPhone(data.customer.phone);
      setProfRtn(data.customer.rtn);
      setProfRazon(data.customer.razon_social);
      setAddresses(data.customer.addresses || []);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccount();
  }, [user]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      if (authMode === 'login') {
        const res = await apiFetch<{ token: string; user: UserAccount }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        onLoginSuccess(res.token, res.user);
      } else {
        const res = await apiFetch<{ token: string; user: UserAccount }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, phone, password, rtn }),
        });
        onLoginSuccess(res.token, res.user);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/customers/my-account', {
        method: 'PUT',
        body: JSON.stringify({
          name: profName,
          phone: profPhone,
          rtn: profRtn,
          razon_social: profRazon,
          addresses,
        }),
      });
      setSaveMsg('Datos personales y direcciones guardados.');
      setTimeout(() => setSaveMsg(''), 3500);
      loadAccount();
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleAddAddress = () => {
    if (!newAddrLabel.trim() || !newAddrText.trim()) return;
    setAddresses((prev) => [
      ...prev,
      {
        id: `addr-${Date.now()}`,
        label: newAddrLabel.trim(),
        address: newAddrText.trim(),
        reference: newAddrRef.trim(),
        zone_id: newAddrZone,
      },
    ]);
    setNewAddrLabel('');
    setNewAddrText('');
    setNewAddrRef('');
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <div className="bg-white border border-[#202633]/12 rounded-xl p-8">
          <h2 className="text-3xl text-[#202633] font-display">
            {authMode === 'login' ? 'Iniciar sesión en Mi Cuenta' : 'Crear cuenta de cliente'}
          </h2>
          <p className="text-sm text-[#202633]/70 mt-1">
            Consulta tus pedidos, repite compras anteriores, guarda direcciones y descarga tus facturas.
          </p>

          <div className="flex items-center gap-1 p-1 bg-[#FFF4E5] rounded-lg mt-6">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                authMode === 'login' ? 'bg-white text-[#202633] shadow-xs' : 'text-[#202633]/65'
              }`}
            >
              Ya tengo cuenta
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
                if (email === 'cliente@correo.hn') setEmail('');
                if (password === '123456') setPassword('');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                authMode === 'register' ? 'bg-white text-[#202633] shadow-xs' : 'text-[#202633]/65'
              }`}
            >
              Registrarme
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="mt-6 space-y-4">
            {authMode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[#202633] mb-1">Nombre completo</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. María Fernanda López"
                    className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#202633] mb-1">Teléfono</label>
                    <input
                      type="text"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+504 9999-0000"
                      className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">Correo electrónico</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">
                Contraseña {authMode === 'register' ? '(mínimo 8 caracteres)' : ''}
              </label>
              <input
                type="password"
                required
                minLength={authMode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={authMode === 'register' ? 'Mínimo 8 caracteres' : ''}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
              />
            </div>

            {authError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-2.5 rounded-lg">{authError}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#2054C9] hover:bg-[#1943A3] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Procesando...' : authMode === 'login' ? 'Iniciar sesión' : 'Crear mi cuenta'}
            </button>
          </form>

          {authMode === 'login' && (
            <div className="mt-5 pt-4 border-t border-[#202633]/12 text-xs text-[#202633]/65">
              Cuenta de prueba lista: <span className="font-mono text-[#202633]">cliente@correo.hn</span> /{' '}
              <span className="font-mono text-[#202633]">123456</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#202633]/12">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Hola, {customer?.name || user.name}</h2>
          <p className="text-sm text-[#202633]/70 mt-0.5">
            {user.email} · {customer?.phone || user.phone}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg self-start whitespace-nowrap shrink-0"
        >
          <LogOut className="w-3.5 h-3.5" />
          Cerrar sesión
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'orders' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
          }`}
        >
          Historial de pedidos ({orders.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('invoices')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'invoices' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
          }`}
        >
          Mis facturas ({invoices.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'profile' ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
          }`}
        >
          Datos y direcciones
        </button>
      </div>

      {activeTab === 'orders' && (
        <div className="space-y-4">
          {orders.length === 0 ? (
            <div className="bg-white border border-[#202633]/12 rounded-xl p-10 text-center text-sm text-[#202633]/60">
              Aún no has realizado pedidos en línea.
            </div>
          ) : (
            orders.map((ord) => (
              <div key={ord.id} className="bg-white border border-[#202633]/12 rounded-xl p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#202633]/10">
                  <div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-mono font-semibold text-[#202633]">{ord.order_number}</span>
                      <span aria-hidden="true" className="text-[#202633]/25">·</span>
                      <span className={`font-semibold ${getStatusColorClass(ord.status)}`}>
                        {ORDER_STATUS_LABELS[ord.status]}
                      </span>
                    </div>
                    <p className="text-xs text-[#202633]/65 mt-1">
                      {ord.created_at} · {ord.delivery_mode === 'domicilio' ? `Envío a ${ord.delivery_address}` : 'Recoger en tienda'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-sans font-bold text-base text-[#202633] mr-2 tabular-nums">
                      {formatCurrency(ord.total)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTrackOrder(ord.order_number)}
                      className="px-3 py-1.5 text-xs font-semibold text-[#202633] bg-[#FFF4E5] hover:bg-[#F9D94A]/40 rounded-lg whitespace-nowrap shrink-0"
                    >
                      Seguir estado
                    </button>
                    <button
                      type="button"
                      onClick={() => onRepeatOrder(ord)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Repetir pedido
                    </button>
                  </div>
                </div>

                <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-[#202633]/75">
                  {(ord.items || []).map((it) => (
                    <div key={it.id} className="flex justify-between py-1 border-b border-[#202633]/8">
                      <span className="truncate pr-2">
                        {it.quantity}× {it.product_name}
                      </span>
                      <span className="font-sans font-semibold tabular-nums text-[#202633] shrink-0">
                        {formatCurrency(it.line_total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'invoices' && (
        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#202633]/60">No tienes facturas emitidas aún.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-xs text-[#202633]/70">
                    <th className="py-3 px-4 font-semibold">N.º Comprobante</th>
                    <th className="py-3 px-4 font-semibold">Pedido</th>
                    <th className="py-3 px-4 font-semibold">Fecha</th>
                    <th className="py-3 px-4 font-semibold">Estado</th>
                    <th className="py-3 px-4 font-semibold text-right">Total</th>
                    <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                      <td className="py-3 px-4 font-mono text-xs font-medium text-[#202633]">{inv.invoice_number}</td>
                      <td className="py-3 px-4 font-mono text-xs text-[#202633]/70">{inv.order_number}</td>
                      <td className="py-3 px-4 text-xs text-[#202633]/70 font-mono">{inv.issued_at}</td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        {inv.status === 'anulada' ? (
                          <span className="text-red-700">Anulada</span>
                        ) : (
                          <span className="text-[#0A7830]">Emitida</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-sans tabular-nums font-bold text-[#202633]">
                        {formatCurrency(inv.total)}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#202633] bg-[#FFF4E5] hover:bg-[#F9D94A]/40 rounded-md"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Ver
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadInvoicePDF(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#2054C9] bg-[#2054C9]/10 hover:bg-[#2054C9]/20 rounded-md"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-[#202633] font-sans">Datos personales y facturación</h3>
            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">Nombre completo</label>
              <input
                type="text"
                required
                value={profName}
                onChange={(e) => setProfName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">Teléfono</label>
              <input
                type="text"
                required
                value={profPhone}
                onChange={(e) => setProfPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">Nombre / Referencia de recibo</label>
              <input
                type="text"
                value={profRazon}
                onChange={(e) => setProfRazon(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg"
              />
            </div>

            {saveMsg && (
              <div className="flex items-center gap-2 text-xs text-[#0A7830] bg-[#13B64B]/12 border border-[#13B64B]/40 p-2.5 rounded-lg font-medium">
                <Check className="w-4 h-4" />
                <span>{saveMsg}</span>
              </div>
            )}

            <button
              type="submit"
              className="px-4 py-2.5 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold rounded-lg"
            >
              Guardar cambios
            </button>
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-[#202633] font-sans">Direcciones guardadas</h3>
            <div className="space-y-3">
              {addresses.map((addr) => (
                <div key={addr.id} className="flex items-start justify-between p-3 border border-[#202633]/12 rounded-lg">
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-[#2054C9] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#202633]">{addr.label}</p>
                      <p className="text-xs text-[#202633]/70">{addr.address}</p>
                      {addr.reference && <p className="text-xs text-[#202633]/55 mt-0.5">Ref: {addr.reference}</p>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddresses((prev) => prev.filter((a) => a.id !== addr.id))}
                    className="p-1.5 text-[#202633]/40 hover:text-red-700"
                    aria-label="Eliminar dirección"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-[#202633]/12 space-y-3">
              <p className="text-xs font-semibold text-[#202633]">Agregar nueva dirección</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Etiqueta (Ej. Casa)"
                  value={newAddrLabel}
                  onChange={(e) => setNewAddrLabel(e.target.value)}
                  className="px-3 py-2 text-xs border border-[#202633]/20 rounded-lg"
                />
                <select
                  value={newAddrZone}
                  onChange={(e) => setNewAddrZone(e.target.value)}
                  className="px-3 py-2 text-xs border border-[#202633]/20 rounded-lg bg-white"
                >
                  {settings.delivery_zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({formatCurrency(z.fee)})
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder="Dirección exacta"
                value={newAddrText}
                onChange={(e) => setNewAddrText(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#202633]/20 rounded-lg"
              />
              <input
                type="text"
                placeholder="Referencias de ubicación"
                value={newAddrRef}
                onChange={(e) => setNewAddrRef(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#202633]/20 rounded-lg"
              />
              <button
                type="button"
                onClick={handleAddAddress}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#2054C9] bg-[#2054C9]/10 hover:bg-[#2054C9]/20 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar dirección (recuerde guardar cambios)
              </button>
            </div>
          </div>
        </form>
      )}

      {selectedInvoice && <InvoiceModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </div>
  );
};
