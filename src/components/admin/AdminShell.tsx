import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingBag,
  MonitorSmartphone,
  Wallet,
  Boxes,
  FileSpreadsheet,
  Truck,
  BarChart3,
  Users,
  Settings,
  LogOut,
  Store,
  Menu,
  X,
  MapPin,
} from 'lucide-react';
import type { BusinessSettings, Order, Product, UserAccount, UserRole } from '../../types';
import { apiFetch } from '../../lib/api';
import { AdminDashboard } from './AdminDashboard';
import { PosTerminal } from './PosTerminal';
import { OrdersManager } from './OrdersManager';
import { CashControl } from './CashControl';
import { ProductsInventoryManager } from './ProductsInventoryManager';
import { BillingCustomersManager } from './BillingCustomersManager';
import { SuppliersPromosManager } from './SuppliersPromosManager';
import { ReportsSettingsManager } from './ReportsSettingsManager';
import { AdminDeliveriesMap } from './AdminDeliveriesMap';
import { DriverDeliveryPanel } from './DriverDeliveryPanel';
import { HelpAssistant } from '../HelpAssistant';

interface AdminShellProps {
  user: UserAccount | null;
  settings: BusinessSettings;
  products: Product[];
  onLoginSuccess: (token: string, user: UserAccount) => void;
  onLogout: () => void;
  onRefreshAll: () => void;
  onReturnToStore: () => void;
}

type AdminTab =
  | 'dashboard'
  | 'orders'
  | 'deliveries'
  | 'pos'
  | 'cash'
  | 'inventory'
  | 'billing'
  | 'suppliers'
  | 'reports'
  | 'users'
  | 'settings';

const ROLE_TABS: Record<UserRole, AdminTab[]> = {
  Administrador: ['dashboard', 'orders', 'deliveries', 'pos', 'cash', 'inventory', 'billing', 'suppliers', 'reports', 'users', 'settings'],
  Cajero: ['dashboard', 'pos', 'cash', 'billing', 'reports'],
  'Encargado de pedidos': ['dashboard', 'orders', 'deliveries', 'billing'],
  'Encargado de inventario': ['dashboard', 'inventory', 'suppliers'],
  Repartidor: ['deliveries', 'orders'],
  Cliente: [],
};

const NAV_ITEMS: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Panel principal', icon: LayoutDashboard },
  { id: 'orders', label: 'Pedidos en línea', icon: ShoppingBag },
  { id: 'deliveries', label: 'Mapa de entregas', icon: MapPin },
  { id: 'pos', label: 'Punto de venta POS', icon: MonitorSmartphone },
  { id: 'cash', label: 'Control de caja', icon: Wallet },
  { id: 'inventory', label: 'Productos e inventario', icon: Boxes },
  { id: 'billing', label: 'Facturación y clientes', icon: FileSpreadsheet },
  { id: 'suppliers', label: 'Proveedores y promos', icon: Truck },
  { id: 'reports', label: 'Reportes', icon: BarChart3 },
  { id: 'users', label: 'Usuarios y bitácora', icon: Users },
  { id: 'settings', label: 'Configuración', icon: Settings },
];

const STAFF_PRESETS = [
  { role: 'Administrador', email: 'admin@lospatrones.hn' },
  { role: 'Cajero', email: 'caja@lospatrones.hn' },
  { role: 'Encargado de pedidos', email: 'pedidos@lospatrones.hn' },
  { role: 'Encargado de inventario', email: 'inventario@lospatrones.hn' },
  { role: 'Repartidor', email: 'repartidor@lospatrones.hn' },
];

export const AdminShell: React.FC<AdminShellProps> = ({
  user,
  settings,
  products,
  onLoginSuccess,
  onLogout,
  onRefreshAll,
  onReturnToStore,
}) => {
  const [email, setEmail] = useState('admin@lospatrones.hn');
  const [password, setPassword] = useState('123456');
  const [authError, setAuthError] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>(products);

  const isStaff = Boolean(user && user.role !== 'Cliente');
  const allowedTabs = useMemo(() => (user ? ROLE_TABS[user.role] || [] : []), [user]);

  useEffect(() => {
    if (allowedTabs.length > 0 && !allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [allowedTabs, activeTab]);

  const loadAdminProducts = async () => {
    try {
      const canSeeAll = user?.role === 'Administrador' || user?.role === 'Encargado de inventario';
      const list = await apiFetch<Product[]>(canSeeAll ? '/api/products?all=1' : '/api/products');
      setAllProducts(list);
    } catch {
      setAllProducts(products);
    }
  };

  const pollPendingOrders = async () => {
    if (!isStaff) return;
    try {
      const orders = await apiFetch<Order[]>('/api/orders?channel=online');
      setPendingOrdersCount(orders.filter((o) => o.status === 'recibido').length);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (isStaff) {
      loadAdminProducts();
      pollPendingOrders();
      const id = setInterval(pollPendingOrders, 15000);
      return () => clearInterval(id);
    }
  }, [isStaff, products]);

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoadingAuth(true);
    try {
      const res = await apiFetch<{ token: string; user: UserAccount }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.user.role === 'Cliente') {
        setAuthError('Esta cuenta pertenece a un cliente. Ingrese con una cuenta de personal.');
        return;
      }
      onLoginSuccess(res.token, res.user);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoadingAuth(false);
    }
  };

  if (!isStaff) {
    return (
      <div className="min-h-screen bg-[#FFF4E5] flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white border border-[#202633]/12 rounded-xl p-8 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={settings.logo_url || '/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png'}
                alt={settings.business_name}
                className="w-11 h-11 rounded-xl object-cover shrink-0 shadow-xs"
              />
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl text-[#202633] font-display leading-none">Sistema Central de Administración</h1>
                <p className="text-xs text-[#202633]/65 mt-1">{settings.business_name}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onReturnToStore}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2054C9] hover:underline whitespace-nowrap shrink-0"
            >
              <Store className="w-3.5 h-3.5" />
              Ir a Tienda
            </button>
          </div>

          <form onSubmit={handleStaffLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">Correo del colaborador</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#202633] mb-1">Contraseña</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#202633]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2054C9]"
              />
            </div>

            {authError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-2.5 rounded-lg">{authError}</p>}

            <button
              type="submit"
              disabled={loadingAuth}
              className="w-full py-2.5 px-4 bg-[#2054C9] hover:bg-[#1943A3] text-white text-sm font-semibold rounded-lg"
            >
              {loadingAuth ? 'Verificando...' : 'Ingresar al sistema'}
            </button>
          </form>

          <div className="pt-4 border-t border-[#202633]/12 space-y-2">
            <p className="text-xs font-medium text-[#202633]/70">Accesos por rol (clave: <span className="font-mono">123456</span>):</p>
            <div className="grid grid-cols-1 gap-1.5">
              {STAFF_PRESETS.map((p) => (
                <button
                  key={p.role}
                  type="button"
                  onClick={() => {
                    setEmail(p.email);
                    setPassword('123456');
                  }}
                  className="flex items-center justify-between px-3 py-1.5 text-xs bg-[#FFF4E5]/60 hover:bg-[#F9D94A]/30 border border-[#202633]/12 rounded-lg text-left"
                >
                  <span className="font-semibold text-[#202633]">{p.role}</span>
                  <span className="font-mono text-[#202633]/65">{p.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Panel';

  return (
    <div className="min-h-screen bg-[#FFF4E5]/45 text-[#202633] flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-[#202633]/12 flex flex-col transition-transform lg:static lg:translate-x-0 no-print ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 border-b border-[#202633]/12 flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-display text-[#202633] text-2xl tracking-wider min-w-0">
            <img
              src={settings.logo_url || '/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png'}
              alt={settings.business_name}
              className="w-8 h-8 rounded-lg object-cover shrink-0"
            />
            <span className="truncate">LOS PATRONES</span>
          </div>
          <button type="button" onClick={() => setMobileMenuOpen(false)} className="lg:hidden p-1 text-[#202633]/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.filter((item) => allowedTabs.includes(item.id)).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors ${
                  active ? 'bg-[#2054C9] text-white' : 'text-[#202633]/75 hover:bg-[#FFF4E5] hover:text-[#202633]'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'orders' && pendingOrdersCount > 0 && (
                  <span
                    className={`font-sans tabular-nums text-[11px] font-bold px-1.5 py-0.5 rounded ${
                      active ? 'bg-[#F9D94A] text-[#202633]' : 'bg-[#F9D94A] text-[#202633]'
                    }`}
                  >
                    {pendingOrdersCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#202633]/12 space-y-2 text-xs">
          <div className="pb-2 border-b border-[#202633]/10">
            <p className="font-semibold text-[#202633] truncate">{user?.name}</p>
            <p className="text-[#202633]/65">{user?.role}</p>
          </div>
          <button
            type="button"
            onClick={onReturnToStore}
            className="w-full flex items-center gap-2 px-3 py-2 text-[#2054C9] bg-[#2054C9]/10 hover:bg-[#2054C9]/15 rounded-lg font-semibold"
          >
            <Store className="w-3.5 h-3.5" />
            Ver Tienda de Clientes
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-[#202633]/75 hover:bg-[#FFF4E5] rounded-lg font-medium"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-[#202633]/12 px-4 sm:px-8 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#202633]/75 hover:bg-[#FFF4E5] rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-[#202633]/65 flex items-center gap-2">
              <span>{settings.business_name}</span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-[#202633]">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {allowedTabs.includes('pos') && activeTab !== 'pos' && (
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="px-3.5 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
              >
                Abrir POS
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && <AdminDashboard onNavigate={(tab) => setActiveTab(tab as AdminTab)} />}
          {activeTab === 'orders' && (
            <OrdersManager
              currentUser={user!}
              onOrderUpdated={() => {
                pollPendingOrders();
                onRefreshAll();
                loadAdminProducts();
              }}
            />
          )}
          {activeTab === 'deliveries' && (
            user?.role === 'Repartidor' ? (
              <DriverDeliveryPanel
                currentUser={user}
                onOrderUpdated={() => {
                  pollPendingOrders();
                  onRefreshAll();
                }}
              />
            ) : (
              <AdminDeliveriesMap
                onOrderUpdated={() => {
                  pollPendingOrders();
                  onRefreshAll();
                }}
              />
            )
          )}
          {activeTab === 'pos' && (
            <PosTerminal
              products={allProducts}
              settings={settings}
              onSaleCompleted={() => {
                onRefreshAll();
                loadAdminProducts();
              }}
              onNavigateCash={() => setActiveTab('cash')}
            />
          )}
          {activeTab === 'cash' && <CashControl />}
          {activeTab === 'inventory' && (
            <ProductsInventoryManager
              products={allProducts}
              settings={settings}
              onRefresh={() => {
                onRefreshAll();
                loadAdminProducts();
              }}
            />
          )}
          {activeTab === 'billing' && <BillingCustomersManager settings={settings} />}
          {activeTab === 'suppliers' && (
            <SuppliersPromosManager
              products={allProducts}
              onRefreshAll={() => {
                onRefreshAll();
                loadAdminProducts();
              }}
            />
          )}
          {(activeTab === 'reports' || activeTab === 'users' || activeTab === 'settings') && (
            <ReportsSettingsManager
              activeSection={activeTab}
              settings={settings}
              onSettingsUpdated={onRefreshAll}
            />
          )}
        </main>
      </div>
      <HelpAssistant
        mode="admin"
        currentScreen={activeTab}
        userRole={user?.role}
        userName={user?.name}
        allowedAdminTabs={allowedTabs}
        onNavigate={(target) => {
          if (allowedTabs.includes(target as AdminTab)) {
            setActiveTab(target as AdminTab);
            setMobileMenuOpen(false);
          }
        }}
      />
    </div>
  );
};
