import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { Order, Product } from '../../types';
import { apiFetch, formatCurrency, ORDER_STATUS_LABELS } from '../../lib/api';

interface DashboardData {
  kpis: {
    today_sales: number;
    month_sales: number;
    pending_orders: number;
    prep_orders: number;
    delivery_orders: number;
    total_products: number;
    low_stock_count: number;
    out_of_stock_count: number;
    expiring_count: number;
  };
  low_stock_products: Product[];
  out_of_stock_products: Product[];
  expiring_products: Product[];
  latest_sales: Order[];
  latest_online_orders: Order[];
  sales_by_day: { day: string; pos_total: number; online_total: number }[];
}

export const AdminDashboard: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<DashboardData>('/api/dashboard');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-[#202633]/12 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxChartVal = Math.max(
    100,
    ...data.sales_by_day.map((d) => Number(d.pos_total) + Number(d.online_total))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Panel principal</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">Resumen operativo consolidado de tienda física y pedidos en línea</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {/* 8 Core KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#202633]/12 rounded-xl p-5">
          <p className="text-xs text-[#202633]/65">Ventas del día</p>
          <p className="text-2xl font-bold text-[#202633] font-sans tabular-nums mt-1">
            {formatCurrency(data.kpis.today_sales)}
          </p>
        </div>
        <div className="bg-white border border-[#202633]/12 rounded-xl p-5">
          <p className="text-xs text-[#202633]/65">Ventas del mes</p>
          <p className="text-2xl font-bold text-[#202633] font-sans tabular-nums mt-1">
            {formatCurrency(data.kpis.month_sales)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('orders')}
          className="bg-white border border-[#202633]/12 hover:border-[#2054C9] rounded-xl p-5 text-left transition-colors"
        >
          <p className="text-xs text-[#202633]/65">Pedidos pendientes / preparación / entrega</p>
          <p className="text-2xl font-bold text-[#202633] font-sans tabular-nums mt-1">
            {data.kpis.pending_orders} <span className="text-[#202633]/25">/</span> {data.kpis.prep_orders}{' '}
            <span className="text-[#202633]/25">/</span> {data.kpis.delivery_orders}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className="bg-white border border-[#202633]/12 hover:border-[#F9D94A] rounded-xl p-5 text-left transition-colors"
        >
          <p className="text-xs text-[#202633]/65">Productos / Stock bajo / Agotados</p>
          <p className="text-2xl font-bold text-[#202633] font-sans tabular-nums mt-1">
            {data.kpis.total_products} <span className="text-[#202633]/25">/</span>{' '}
            <span className="text-[#8A6D00]">{data.kpis.low_stock_count}</span>{' '}
            <span className="text-[#202633]/25">/</span>{' '}
            <span className="text-red-700">{data.kpis.out_of_stock_count}</span>
          </p>
        </button>
      </div>

      {/* Sales Chart + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#202633] font-sans">Gráfico de ventas recientes (POS vs En línea)</h3>
            <div className="flex items-center gap-4 text-xs text-[#202633]/75">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#2054C9] rounded-xs" /> POS Presencial
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#13B64B] rounded-xs" /> En Línea
              </span>
            </div>
          </div>

          {data.sales_by_day.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#202633]/60">Sin ventas registradas en los últimos 7 días.</div>
          ) : (
            <div className="pt-4 space-y-3">
              {data.sales_by_day.map((row) => {
                const posPct = Math.round((row.pos_total / maxChartVal) * 100);
                const onlinePct = Math.round((row.online_total / maxChartVal) * 100);
                return (
                  <div key={row.day} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono text-[#202633]/70">{row.day}</span>
                      <span className="font-sans tabular-nums font-bold text-[#202633]">
                        {formatCurrency(row.pos_total + row.online_total)}
                      </span>
                    </div>
                    <div className="h-3 w-full bg-[#FFF4E5] rounded-sm overflow-hidden flex">
                      <div style={{ width: `${posPct}%` }} className="bg-[#2054C9] h-full" title={`POS: ${formatCurrency(row.pos_total)}`} />
                      <div style={{ width: `${onlinePct}%` }} className="bg-[#13B64B] h-full" title={`En línea: ${formatCurrency(row.online_total)}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#202633] font-sans flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#8A6D00]" />
              Alertas de inventario
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-[#2054C9] hover:underline"
            >
              Gestionar
            </button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {data.out_of_stock_products.map((p) => (
              <div key={`out-${p.id}`} className="flex items-center justify-between py-2 border-b border-[#202633]/8">
                <span className="font-medium text-[#202633] truncate pr-2">{p.name}</span>
                <span className="text-red-700 font-semibold shrink-0">Agotado (0)</span>
              </div>
            ))}
            {data.low_stock_products.map((p) => (
              <div key={`low-${p.id}`} className="flex items-center justify-between py-2 border-b border-[#202633]/8">
                <span className="font-medium text-[#202633] truncate pr-2">{p.name}</span>
                <span className="text-[#8A6D00] font-mono font-semibold shrink-0">
                  Stock: {p.stock} / Mín: {p.min_stock}
                </span>
              </div>
            ))}
            {data.expiring_products.map((p) => (
              <div key={`exp-${p.id}`} className="flex items-center justify-between py-2 border-b border-[#202633]/8">
                <span className="font-medium text-[#202633] truncate pr-2">{p.name}</span>
                <span className="text-[#8A6D00] font-mono shrink-0">Vence: {p.expiry_date}</span>
              </div>
            ))}
            {data.out_of_stock_products.length === 0 &&
              data.low_stock_products.length === 0 &&
              data.expiring_products.length === 0 && (
                <p className="text-[#0A7830] py-4 text-center font-medium">Inventario en niveles saludables.</p>
              )}
          </div>
        </div>
      </div>

      {/* Latest Sales & Latest Online Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#202633]/12 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#202633] font-sans">Últimas ventas</h3>
            <button type="button" onClick={() => onNavigate('pos')} className="text-xs text-[#2054C9] font-semibold">
              Ir al POS
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-2.5 px-4 font-semibold">Referencia</th>
                  <th className="py-2.5 px-4 font-semibold">Canal</th>
                  <th className="py-2.5 px-4 font-semibold">Cliente</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.latest_sales.map((s) => (
                  <tr key={s.id} className="border-b border-[#202633]/8">
                    <td className="py-2.5 px-4 font-mono font-medium text-[#202633]">{s.order_number}</td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{s.channel === 'pos' ? 'POS' : 'En línea'}</td>
                    <td className="py-2.5 px-4 text-[#202633] truncate max-w-[140px]">{s.customer_name}</td>
                    <td className="py-2.5 px-4 text-right font-sans tabular-nums font-bold">{formatCurrency(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#202633]/12 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#202633] font-sans">Últimos pedidos en línea</h3>
            <button type="button" onClick={() => onNavigate('orders')} className="text-xs text-[#2054C9] font-semibold">
              Ver todos
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-2.5 px-4 font-semibold">Pedido</th>
                  <th className="py-2.5 px-4 font-semibold">Cliente</th>
                  <th className="py-2.5 px-4 font-semibold">Estado</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.latest_online_orders.map((o) => (
                  <tr key={o.id} className="border-b border-[#202633]/8">
                    <td className="py-2.5 px-4 font-mono font-medium text-[#202633]">{o.order_number}</td>
                    <td className="py-2.5 px-4 text-[#202633] truncate max-w-[140px]">{o.customer_name}</td>
                    <td className="py-2.5 px-4 text-[#202633]/75">{ORDER_STATUS_LABELS[o.status]}</td>
                    <td className="py-2.5 px-4 text-right font-sans tabular-nums font-bold">{formatCurrency(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
