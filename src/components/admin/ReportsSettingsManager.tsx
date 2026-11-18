import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Shield, Database, Save, Plus, ScanBarcode, Camera, CheckCircle2 } from 'lucide-react';
import type { AuditLog, BusinessSettings, ScannerConfig, UserAccount, UserRole } from '../../types';
import { apiFetch, exportReportPDF, exportRowsToExcel, formatCurrency } from '../../lib/api';

const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  hid_enabled: true,
  suffix_key: 'Enter',
  auto_focus_pos: true,
  beep_on_scan: true,
  camera_enabled: true,
  preferred_camera_facing: 'environment',
  auto_increment_qty: true,
};

interface Props {
  activeSection: 'reports' | 'users' | 'settings';
  settings: BusinessSettings;
  onSettingsUpdated: () => void;
}

export const ReportsSettingsManager: React.FC<Props> = ({ activeSection, settings, onSettingsUpdated }) => {
  // Reports state
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState('2027-12-31');
  const [reportData, setReportData] = useState<any>(null);
  const [reportTab, setReportTab] = useState<'resumen' | 'productos' | 'canales' | 'financiero'>('resumen');

  // Users & Audit state
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [newUserModal, setNewUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', phone: '', password: '', role: 'Cajero' as UserRole });

  // Settings state
  const [cfg, setCfg] = useState<BusinessSettings>({
    ...settings,
    scanner_config: { ...DEFAULT_SCANNER_CONFIG, ...(settings.scanner_config || {}) },
  });
  const [saveNotice, setSaveNotice] = useState('');
  const [scannerTestInput, setScannerTestInput] = useState('');
  const [scannerTestResult, setScannerTestResult] = useState<{ code: string; length: number; timestamp: string } | null>(null);

  useEffect(() => {
    setCfg({
      ...settings,
      scanner_config: { ...DEFAULT_SCANNER_CONFIG, ...(settings.scanner_config || {}) },
    });
  }, [settings]);

  const loadReports = async () => {
    const res = await apiFetch(`/api/reports?start=${startDate}&end=${endDate}`);
    setReportData(res);
  };

  const loadUsersAndAudit = async () => {
    const [uRes, aRes] = await Promise.all([
      apiFetch<UserAccount[]>('/api/users').catch(() => []),
      apiFetch<AuditLog[]>('/api/audit-logs').catch(() => []),
    ]);
    setUsers(uRes);
    setAuditLogs(aRes);
  };

  useEffect(() => {
    if (activeSection === 'reports') loadReports();
    if (activeSection === 'users') loadUsersAndAudit();
  }, [activeSection]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(userForm) });
    setNewUserModal(false);
    setUserForm({ name: '', email: '', phone: '', password: '', role: 'Cajero' });
    loadUsersAndAudit();
  };

  const handleToggleUser = async (u: UserAccount) => {
    await apiFetch(`/api/users/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...u, is_active: u.is_active === 1 ? 0 : 1 }),
    });
    loadUsersAndAudit();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(cfg) });
    setSaveNotice('Configuración general, coordenadas, escáner, zonas y bancos guardados.');
    setTimeout(() => setSaveNotice(''), 4000);
    onSettingsUpdated();
  };

  const handleDownloadBackup = async () => {
    const data = await apiFetch('/api/backup/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Respaldo_LosPatrones_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (activeSection === 'reports') {
    const totalPos = (reportData?.valid_orders || [])
      .filter((o: any) => o.channel === 'pos')
      .reduce((a: number, b: any) => a + b.total, 0);
    const totalOnline = (reportData?.valid_orders || [])
      .filter((o: any) => o.channel === 'online')
      .reduce((a: number, b: any) => a + b.total, 0);

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl text-[#202633] font-display">Reportes y Estadísticas</h2>
            <p className="text-xs text-[#202633]/65 mt-0.5">
              Ventas diarias/semanales/mensuales, rentabilidad por producto, canales POS vs en línea, gastos y arqueos.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 font-mono border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 font-mono border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
            />
            <button
              type="button"
              onClick={loadReports}
              className="px-3.5 py-1.5 bg-[#2054C9] hover:bg-[#1943A3] text-white rounded-lg font-semibold"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={() =>
                reportData &&
                exportRowsToExcel('Reporte_Productos_LosPatrones', 'Productos', reportData.product_performance)
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] text-[#202633] rounded-lg font-semibold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#0A7830]" />
              Excel
            </button>
            <button
              type="button"
              onClick={() =>
                reportData &&
                exportReportPDF(
                  'Desempeño por Producto',
                  ['SKU', 'Producto', 'Categoría', 'Unidades', 'Ingresos', 'Ganancia Est.'],
                  reportData.product_performance.map((p: any) => [
                    p.internal_code,
                    p.name,
                    p.category,
                    p.units_sold,
                    formatCurrency(p.revenue),
                    formatCurrency(p.estimated_profit),
                  ]),
                  'Reporte_LosPatrones'
                )
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] text-[#202633] rounded-lg font-semibold"
            >
              <Download className="w-3.5 h-3.5 text-red-700" />
              PDF
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg w-fit overflow-x-auto max-w-full">
          {[
            ['resumen', 'Diarias / Semanales / Mensuales'],
            ['productos', 'Más/Menos vendidos y Ganancia'],
            ['canales', 'POS vs En línea y Pagos'],
            ['financiero', 'Gastos, Compras y Caja'],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setReportTab(k as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                reportTab === k ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {reportData && reportTab === 'resumen' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[
              ['Ventas Diarias', reportData.daily_series],
              ['Ventas Semanales', reportData.weekly_series],
              ['Ventas Mensuales', reportData.monthly_series],
            ].map(([title, rows]: any) => (
              <div key={title} className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#202633]/12 font-bold text-xs text-[#202633]">{title}</div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#202633]/10 bg-[#FFF4E5]/60 text-[#202633]/70">
                      <th className="py-2 px-3 font-semibold">Periodo</th>
                      <th className="py-2 px-3 text-right font-semibold">Órdenes</th>
                      <th className="py-2 px-3 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.period} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                        <td className="py-2 px-3 font-mono text-[#202633]">{r.period}</td>
                        <td className="py-2 px-3 text-right font-sans tabular-nums">{r.orders_count}</td>
                        <td className="py-2 px-3 text-right font-sans tabular-nums font-bold text-[#202633]">{formatCurrency(r.total_sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {reportData && reportTab === 'productos' && (
          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-3 px-4 font-semibold">SKU</th>
                  <th className="py-3 px-4 font-semibold">Producto</th>
                  <th className="py-3 px-4 font-semibold">Categoría</th>
                  <th className="py-3 px-4 font-semibold text-right">Unidades vendidas</th>
                  <th className="py-3 px-4 font-semibold text-right">Ingresos</th>
                  <th className="py-3 px-4 font-semibold text-right">Ganancia estimada</th>
                </tr>
              </thead>
              <tbody>
                {reportData.product_performance.map((p: any) => (
                  <tr key={p.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                    <td className="py-2.5 px-4 font-mono text-[#202633]">{p.internal_code}</td>
                    <td className="py-2.5 px-4 font-semibold text-[#202633]">{p.name}</td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{p.category}</td>
                    <td className="py-2.5 px-4 text-right font-sans tabular-nums font-semibold">{p.units_sold}</td>
                    <td className="py-2.5 px-4 text-right font-sans tabular-nums font-semibold">{formatCurrency(p.revenue)}</td>
                    <td className="py-2.5 px-4 text-right font-sans tabular-nums font-bold text-[#0A7830]">
                      {formatCurrency(p.estimated_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reportData && reportTab === 'canales' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-2">
              <p className="text-[#202633]/65 font-medium">Ventas Presenciales (POS)</p>
              <p className="text-2xl font-bold font-sans tabular-nums text-[#2054C9]">{formatCurrency(totalPos)}</p>
            </div>
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-2">
              <p className="text-[#202633]/65 font-medium">Pedidos en Línea</p>
              <p className="text-2xl font-bold font-sans tabular-nums text-[#0A7830]">{formatCurrency(totalOnline)}</p>
            </div>
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-2">
              <p className="text-[#202633]/65 font-medium">Pedidos Cancelados / Rechazados</p>
              <p className="text-2xl font-bold font-sans tabular-nums text-red-700">{reportData.cancelled_orders.length}</p>
            </div>

            <div className="md:col-span-3 bg-white border border-[#202633]/12 rounded-xl p-5 space-y-3">
              <h4 className="font-bold text-[#202633]">Desglose por método de pago</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {reportData.payment_breakdown.map((pm: any) => (
                  <div key={pm.payment_method} className="p-4 bg-[#FFF4E5]/60 rounded-lg border border-[#202633]/12 flex justify-between">
                    <span className="font-semibold capitalize text-[#202633]">{pm.payment_method} ({pm.count} transacciones)</span>
                    <span className="font-sans tabular-nums font-bold text-[#202633]">{formatCurrency(pm.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {reportData && reportTab === 'financiero' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-3">
              <h4 className="font-bold text-[#202633]">Gastos registrados en caja ({reportData.expenses.length})</h4>
              {reportData.expenses.map((g: any) => (
                <div key={g.id} className="flex justify-between py-2 border-b border-[#202633]/8">
                  <span className="text-[#202633]">{g.concept} ({g.created_at})</span>
                  <span className="font-sans tabular-nums font-bold text-red-700">{formatCurrency(g.amount)}</span>
                </div>
              ))}
            </div>
            <div className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-3">
              <h4 className="font-bold text-[#202633]">Diferencias de cierres de caja</h4>
              {reportData.cash_diffs.map((c: any) => (
                <div key={c.id} className="flex justify-between py-2 border-b border-[#202633]/8">
                  <span className="text-[#202633]">{c.opened_by_name} · {c.closed_at}</span>
                  <span className={`font-sans tabular-nums font-bold ${c.difference === 0 ? 'text-[#0A7830]' : 'text-red-700'}`}>
                    {formatCurrency(c.difference)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeSection === 'users') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl text-[#202633] font-display">Usuarios, Permisos y Bitácora</h2>
            <p className="text-xs text-[#202633]/65 mt-0.5">
              Control de acceso por rol (Administrador, Cajero, Encargado de pedidos, Encargado de inventario, Repartidor) e historial de operaciones.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNewUserModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Crear usuario
          </button>
        </div>

        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                <th className="py-3 px-4 font-semibold">Nombre</th>
                <th className="py-3 px-4 font-semibold">Correo</th>
                <th className="py-3 px-4 font-semibold">Rol / Permisos</th>
                <th className="py-3 px-4 font-semibold">Teléfono</th>
                <th className="py-3 px-4 font-semibold text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                  <td className="py-3 px-4 font-semibold text-[#202633]">{u.name}</td>
                  <td className="py-3 px-4 font-mono text-[#202633]/70">{u.email}</td>
                  <td className="py-3 px-4 font-semibold text-[#2054C9]">{u.role}</td>
                  <td className="py-3 px-4 font-mono text-[#202633]/70">{u.phone}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleToggleUser(u)}
                      className={`px-2.5 py-1 rounded font-semibold ${
                        u.is_active === 1 ? 'bg-[#13B64B]/12 text-[#0A7830]' : 'bg-[#202633]/8 text-[#202633]/60'
                      }`}
                    >
                      {u.is_active === 1 ? 'Activo' : 'Desactivado'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#202633]/12 flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#2054C9]" />
            <h3 className="text-sm font-bold text-[#202633] font-sans">Historial de operaciones por usuario</h3>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-2.5 px-4 font-semibold">Fecha y hora</th>
                  <th className="py-2.5 px-4 font-semibold">Usuario (Rol)</th>
                  <th className="py-2.5 px-4 font-semibold">Módulo</th>
                  <th className="py-2.5 px-4 font-semibold">Acción</th>
                  <th className="py-2.5 px-4 font-semibold">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-[#202633]/8">
                    <td className="py-2.5 px-4 font-mono text-[#202633]/60">{log.created_at}</td>
                    <td className="py-2.5 px-4 font-semibold text-[#202633]">
                      {log.user_name} <span className="text-[#202633]/45 font-normal">({log.user_role})</span>
                    </td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{log.module}</td>
                    <td className="py-2.5 px-4 font-semibold text-[#202633]">{log.action}</td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {newUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
            <form onSubmit={handleCreateUser} className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-md p-6 space-y-3 text-xs">
              <h3 className="text-base font-bold text-[#202633] font-sans">Crear usuario del sistema</h3>
              <input
                type="text"
                required
                placeholder="Nombre completo *"
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="email"
                required
                placeholder="Correo electrónico *"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="text"
                placeholder="Teléfono"
                value={userForm.phone}
                onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <select
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                <option value="Administrador">Administrador</option>
                <option value="Cajero">Cajero</option>
                <option value="Encargado de pedidos">Encargado de pedidos</option>
                <option value="Encargado de inventario">Encargado de inventario</option>
                <option value="Repartidor">Repartidor</option>
              </select>
              <input
                type="password"
                required
                placeholder="Contraseña inicial *"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setNewUserModal(false)} className="px-4 py-2 bg-[#FFF4E5] text-[#202633] font-medium rounded-lg">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white rounded-lg font-semibold">
                  Crear usuario
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // Settings + Backups
  return (
    <form onSubmit={handleSaveSettings} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Configuración General y Respaldos</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            Datos del negocio, coordenadas GPS, zonas de entrega, cuentas bancarias, impresoras y copias de seguridad.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5" />
            Descargar copia de seguridad
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#202633] bg-[#13B64B] hover:bg-[#10A041] rounded-lg whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            Guardar configuración
          </button>
        </div>
      </div>

      {saveNotice && (
        <div className="p-3 bg-[#13B64B]/12 border border-[#13B64B]/30 text-[#0A7830] font-semibold text-xs rounded-lg">{saveNotice}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
        <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-[#202633] font-sans">Identidad, contacto y horarios</h3>
          <div>
            <label className="block font-semibold text-[#202633]/80 mb-1">Nombre comercial</label>
            <input
              type="text"
              value={cfg.business_name}
              onChange={(e) => setCfg({ ...cfg, business_name: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
          </div>
          <div>
            <label className="block font-semibold text-[#202633]/80 mb-1">Dirección física</label>
            <input
              type="text"
              value={cfg.address}
              onChange={(e) => setCfg({ ...cfg, address: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">Teléfonos</label>
              <input
                type="text"
                value={cfg.phones}
                onChange={(e) => setCfg({ ...cfg, phones: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">Monto mínimo domicilio (L.)</label>
              <input
                type="number"
                value={cfg.min_order_amount}
                onChange={(e) => setCfg({ ...cfg, min_order_amount: Number(e.target.value) })}
                className="w-full px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold text-[#202633]/80 mb-1">Horarios de atención</label>
            <input
              type="text"
              value={cfg.hours}
              onChange={(e) => setCfg({ ...cfg, hours: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">
                Latitud establecimiento (GPS)
              </label>
              <input
                type="number"
                step="0.000001"
                value={cfg.store_lat ?? 15.612194}
                onChange={(e) => setCfg({ ...cfg, store_lat: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">
                Longitud establecimiento (GPS)
              </label>
              <input
                type="number"
                step="0.000001"
                value={cfg.store_lng ?? -87.939167}
                onChange={(e) => setCfg({ ...cfg, store_lng: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <p className="col-span-2 text-[11px] text-[#202633]/55 font-mono">
              Referencia oficial: 15°36'43.9"N 87°56'21.0"W (15.612194, -87.939167)
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#202633] font-sans">Zonas y tarifas de entrega</h3>
          {cfg.delivery_zones.map((z, idx) => (
            <div key={z.id} className="grid grid-cols-12 gap-2 items-center">
              <input
                type="text"
                value={z.name}
                onChange={(e) => {
                  const next = [...cfg.delivery_zones];
                  next[idx].name = e.target.value;
                  setCfg({ ...cfg, delivery_zones: next });
                }}
                className="col-span-6 px-2.5 py-1.5 border border-[#202633]/20 rounded text-[#202633]"
              />
              <input
                type="number"
                value={z.fee}
                onChange={(e) => {
                  const next = [...cfg.delivery_zones];
                  next[idx].fee = Number(e.target.value);
                  setCfg({ ...cfg, delivery_zones: next });
                }}
                className="col-span-3 px-2.5 py-1.5 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded text-[#202633]"
              />
              <input
                type="text"
                value={z.eta}
                onChange={(e) => {
                  const next = [...cfg.delivery_zones];
                  next[idx].eta = e.target.value;
                  setCfg({ ...cfg, delivery_zones: next });
                }}
                className="col-span-3 px-2.5 py-1.5 border border-[#202633]/20 rounded text-[#202633]"
              />
            </div>
          ))}
        </div>

        <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#202633] font-sans">Impresoras, hardware y notificaciones</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">Impresora térmica</label>
              <input
                type="text"
                value={cfg.printer_config.printer_name}
                onChange={(e) =>
                  setCfg({ ...cfg, printer_config: { ...cfg.printer_config, printer_name: e.target.value } })
                }
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div>
              <label className="block font-semibold text-[#202633]/80 mb-1">Ancho de papel térmico</label>
              <select
                value={cfg.printer_config.thermal_width}
                onChange={(e) =>
                  setCfg({ ...cfg, printer_config: { ...cfg.printer_config, thermal_width: e.target.value as any } })
                }
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                <option value="80mm">80mm Estándar</option>
                <option value="58mm">58mm Compacta</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-2">
            <label className="inline-flex items-center gap-2 text-[#202633]">
              <input
                type="checkbox"
                checked={cfg.printer_config.open_cash_drawer}
                onChange={(e) =>
                  setCfg({ ...cfg, printer_config: { ...cfg.printer_config, open_cash_drawer: e.target.checked } })
                }
              />
              <span>Apertura automática de cajón de dinero</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[#202633]">
              <input
                type="checkbox"
                checked={cfg.notifications_config.sound_new_order}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    notifications_config: { ...cfg.notifications_config, sound_new_order: e.target.checked },
                  })
                }
              />
              <span>Notificación sonora de nuevos pedidos</span>
            </label>
          </div>
        </div>

        <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4 lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#202633]/10 pb-3">
            <div className="flex items-center gap-2">
              <ScanBarcode className="w-4 h-4 text-[#2054C9]" />
              <h3 className="text-sm font-bold text-[#202633] font-sans">
                Configuración del escáner de códigos de barras (USB / Inalámbrico / Cámara)
              </h3>
            </div>
            <span className="text-[11px] text-[#202633]/60">
              Compatible con lectores HID tipo teclado y cámara web o móvil
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="font-bold text-[#202633]">Lector USB / Inalámbrico (Entrada HID)</h4>
              <div className="space-y-2 text-[#202633]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.scanner_config.hid_enabled}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        scanner_config: { ...cfg.scanner_config, hid_enabled: e.target.checked },
                      })
                    }
                  />
                  <span>Habilitar captura automática de lector USB o inalámbrico en POS e Inventario</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.scanner_config.auto_focus_pos}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        scanner_config: { ...cfg.scanner_config, auto_focus_pos: e.target.checked },
                      })
                    }
                  />
                  <span>Mantener enfoque automático de lectura en Punto de Venta</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.scanner_config.auto_increment_qty}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        scanner_config: { ...cfg.scanner_config, auto_increment_qty: e.target.checked },
                      })
                    }
                  />
                  <span>Sumar +1 automáticamente si se escanea el mismo producto varias veces</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cfg.scanner_config.beep_on_scan}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        scanner_config: { ...cfg.scanner_config, beep_on_scan: e.target.checked },
                      })
                    }
                  />
                  <span>Emitir sonido de confirmación / alerta al escanear</span>
                </label>
              </div>

              <div className="pt-1">
                <label className="block font-semibold text-[#202633]/80 mb-1">
                  Tecla de fin de lectura (sufijo del lector)
                </label>
                <select
                  value={cfg.scanner_config.suffix_key}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      scanner_config: {
                        ...cfg.scanner_config,
                        suffix_key: e.target.value as ScannerConfig['suffix_key'],
                      },
                    })
                  }
                  className="w-full sm:w-64 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  <option value="Enter">Enter (Intro — Estándar USB/Bluetooth)</option>
                  <option value="Tab">Tab (Tabulador)</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#2054C9]" />
                  <h4 className="font-bold text-[#202633]">Escáner con cámara del dispositivo</h4>
                </div>
                <label className="flex items-center gap-2 text-[#202633]">
                  <input
                    type="checkbox"
                    checked={cfg.scanner_config.camera_enabled}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        scanner_config: { ...cfg.scanner_config, camera_enabled: e.target.checked },
                      })
                    }
                  />
                  <span>Permitir escanear códigos con la cámara del celular o computadora</span>
                </label>
                <div>
                  <label className="block font-semibold text-[#202633]/80 mb-1">Cámara predeterminada</label>
                  <select
                    value={cfg.scanner_config.preferred_camera_facing}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        scanner_config: {
                          ...cfg.scanner_config,
                          preferred_camera_facing: e.target.value as ScannerConfig['preferred_camera_facing'],
                        },
                      })
                    }
                    className="w-full sm:w-64 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                  >
                    <option value="environment">Cámara trasera (recomendada en móviles)</option>
                    <option value="user">Cámara frontal / webcam</option>
                  </select>
                </div>
              </div>

              <div className="p-4 bg-[#FFF4E5]/60 border border-[#202633]/12 rounded-lg space-y-2">
                <label className="block font-bold text-[#202633]">
                  Probar lector USB / inalámbrico aquí
                </label>
                <p className="text-[11px] text-[#202633]/65">
                  Haga clic en el campo y dispare el lector sobre cualquier código de barras para verificar el sufijo ({cfg.scanner_config.suffix_key}).
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={scannerTestInput}
                    onChange={(e) => setScannerTestInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === cfg.scanner_config.suffix_key || e.key === 'Enter') {
                        e.preventDefault();
                        const cleaned = scannerTestInput.trim();
                        if (cleaned) {
                          setScannerTestResult({
                            code: cleaned,
                            length: cleaned.length,
                            timestamp: new Date().toLocaleTimeString(),
                          });
                          setScannerTestInput('');
                        }
                      }
                    }}
                    placeholder="Escanee un código aquí para probar..."
                    className="flex-1 px-3 py-2 font-mono text-xs border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cleaned = scannerTestInput.trim();
                      if (cleaned) {
                        setScannerTestResult({
                          code: cleaned,
                          length: cleaned.length,
                          timestamp: new Date().toLocaleTimeString(),
                        });
                        setScannerTestInput('');
                      }
                    }}
                    className="px-3 py-2 text-xs font-semibold bg-[#2054C9] hover:bg-[#1943A3] text-white rounded-lg whitespace-nowrap shrink-0"
                  >
                    Verificar
                  </button>
                </div>
                {scannerTestResult && (
                  <div className="flex items-center gap-2 pt-1 text-[#0A7830] font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-mono tabular-nums">
                      Lectura correcta: {scannerTestResult.code} ({scannerTestResult.length} caracteres · {scannerTestResult.timestamp})
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
};
