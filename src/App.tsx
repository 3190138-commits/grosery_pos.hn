/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import type { BusinessSettings, Product, Promotion, UserAccount } from './types';
import { apiFetch, getAuthToken, setAuthToken } from './lib/api';
import { CustomerStorefront } from './components/CustomerStorefront';
import { AdminShell } from './components/admin/AdminShell';

export default function App() {
  const [mode, setMode] = useState<'store' | 'admin'>('store');
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStorefront = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{
        settings: BusinessSettings;
        products: Product[];
        promotions: Promotion[];
      }>('/api/storefront/init');
      setSettings(data.settings);
      setProducts(data.products);
      setPromotions(data.promotions);
    } catch (err: any) {
      setLoadError(err?.message || 'No se pudo conectar con el servidor de Los Patrones Mini Market.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStorefront();
    const token = getAuthToken();
    if (token) {
      apiFetch<{ user: UserAccount }>('/api/auth/me')
        .then((res) => setUser(res.user))
        .catch(() => setAuthToken(null));
    }
  }, []);

  const handleLoginSuccess = (token: string, loggedUser: UserAccount) => {
    setAuthToken(token);
    setUser(loggedUser);
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF4E5] flex items-center justify-center p-6">
        <div className="text-sm text-[#202633] font-medium">Cargando Los Patrones Mini Market...</div>
      </div>
    );
  }

  if (loadError || !settings) {
    return (
      <div className="min-h-screen bg-[#FFF4E5] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#0B0B0F]/15 rounded-2xl p-6 shadow-sm text-center space-y-4">
          <h1 className="text-lg font-bold text-[#0B0B0F]">No se pudo cargar el sistema</h1>
          <p className="text-sm text-[#202633]">
            {loadError || 'El servidor backend no respondió.'}
          </p>
          <p className="text-xs text-[#202633]/75">
            Esta aplicación requiere su servidor Express + SQLite activo (por ejemplo en Cloud Run / Node.js). En alojamientos estáticos sin backend conectado, las rutas <code className="font-mono">/api/*</code> devolverán 404.
          </p>
          <button
            type="button"
            onClick={loadStorefront}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#2054C9] text-white text-sm font-semibold hover:bg-[#1944A6] cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'admin') {
    return (
      <AdminShell
        user={user}
        settings={settings}
        products={products}
        onLoginSuccess={handleLoginSuccess}
        onLogout={handleLogout}
        onRefreshAll={loadStorefront}
        onReturnToStore={() => setMode('store')}
      />
    );
  }

  return (
    <CustomerStorefront
      settings={settings}
      products={products}
      promotions={promotions}
      user={user}
      onLoginSuccess={handleLoginSuccess}
      onLogout={handleLogout}
      onOrderCreated={loadStorefront}
      onOpenAdmin={() => setMode('admin')}
    />
  );
}
