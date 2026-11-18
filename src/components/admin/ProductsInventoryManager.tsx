import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Plus,
  Upload,
  Edit3,
  History,
  ClipboardCheck,
  AlertTriangle,
  Download,
  Barcode,
  Camera,
  Trash2,
  Printer,
  Sparkles,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  type BusinessSettings,
  type InventoryMovement,
  type PriceHistory,
  type Product,
  type ProductBarcode,
  type ProductCategory,
} from '../../types';
import { apiFetch, formatCurrency } from '../../lib/api';
import { playScanBeep } from '../../lib/scannerAudio';
import { CameraBarcodeModal } from '../CameraBarcodeModal';
import { BarcodeLabelModal } from '../BarcodeLabelModal';

interface Props {
  settings: BusinessSettings;
  products: Product[];
  onRefresh: () => void;
}

export const ProductsInventoryManager: React.FC<Props> = ({ settings, products, onRefresh }) => {
  const scannerCfg = settings.scanner_config || {
    beep_on_scan: true,
    camera_enabled: true,
    preferred_camera_facing: 'environment',
  };

  const [subTab, setSubTab] = useState<'productos' | 'movimientos' | 'conteo' | 'alertas'>('productos');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Todas');
  const [editingProd, setEditingProd] = useState<Partial<Product> | null>(null);
  const [prodFormError, setProdFormError] = useState('');
  const [priceHistory, setPriceHistory] = useState<{ prodName: string; items: PriceHistory[] } | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);

  // Multi-barcode manager modal
  const [barcodeModalProdId, setBarcodeModalProdId] = useState<number | null>(null);
  const [newBcCode, setNewBcCode] = useState('');
  const [newBcType, setNewBcType] = useState<'comercial' | 'interno'>('comercial');
  const [newBcPres, setNewBcPres] = useState('');
  const [newBcPrice, setNewBcPrice] = useState('');
  const [bcError, setBcError] = useState('');
  const [labelPreview, setLabelPreview] = useState<{
    product: Product;
    code: string;
    presentation?: string;
    price?: number;
  } | null>(null);

  // Inventory stock lookup & scan inputs
  const [lookupScanInput, setLookupScanInput] = useState('');
  const [lookupResult, setLookupResult] = useState<Product | null>(null);
  const [lookupError, setLookupError] = useState('');

  // Inventory adjustment form
  const [adjProdId, setAdjProdId] = useState<number>(products[0]?.id || 0);
  const [adjScanInput, setAdjScanInput] = useState('');
  const [adjType, setAdjType] = useState<'entrada' | 'salida' | 'ajuste' | 'perdida_danado'>('entrada');
  const [adjQty, setAdjQty] = useState('1');
  const [adjReason, setAdjReason] = useState('');
  const [adjExpiry, setAdjExpiry] = useState('');

  // Physical count map + scanner
  const [physicalCounts, setPhysicalCounts] = useState<Record<number, string>>({});
  const [countScanInput, setCountScanInput] = useState('');
  const [lastCountScannedId, setLastCountScannedId] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Reusable Camera modal target
  const [cameraTarget, setCameraTarget] = useState<'edit_prod' | 'add_bc' | 'lookup' | 'adjust' | 'count' | null>(null);

  const loadMovements = async () => {
    const res = await apiFetch<InventoryMovement[]>('/api/inventory/movements');
    setMovements(res);
  };

  useEffect(() => {
    loadMovements();
  }, []);

  const barcodeModalProd = barcodeModalProdId ? products.find((p) => p.id === barcodeModalProdId) || null : null;

  const findProductByScan = async (rawCode: string): Promise<Product | null> => {
    const code = rawCode.trim();
    if (!code) return null;
    const lower = code.toLowerCase();
    const local = products.find(
      (p) =>
        p.internal_code.toLowerCase() === lower ||
        p.barcode.toLowerCase() === lower ||
        (p.barcodes || []).some((b) => b.code.toLowerCase() === lower)
    );
    if (local) return local;
    try {
      const res = await apiFetch<{ product: Product }>(`/api/barcodes/lookup/${encodeURIComponent(code)}`);
      return res.product;
    } catch {
      return null;
    }
  };

  const handleLookupScan = async (rawCode: string) => {
    setLookupError('');
    const found = await findProductByScan(rawCode);
    if (found) {
      if (scannerCfg.beep_on_scan) playScanBeep('success');
      setLookupResult(found);
      setLookupScanInput('');
    } else {
      if (scannerCfg.beep_on_scan) playScanBeep('error');
      setLookupResult(null);
      setLookupError(`El código "${rawCode}" no está registrado.`);
    }
  };

  const handleAdjScan = async (rawCode: string) => {
    const found = await findProductByScan(rawCode);
    if (found) {
      if (scannerCfg.beep_on_scan) playScanBeep('success');
      if (adjProdId === found.id && adjType === 'entrada') {
        setAdjQty((prev) => String((Number(prev) || 0) + 1));
      } else {
        setAdjProdId(found.id);
        setAdjQty('1');
      }
      setAdjScanInput('');
      setStatusMsg(`Producto seleccionado por escáner: ${found.name} (Stock actual: ${found.stock})`);
      setTimeout(() => setStatusMsg(''), 3000);
    } else {
      if (scannerCfg.beep_on_scan) playScanBeep('error');
      setStatusMsg(`Código "${rawCode}" no encontrado en catálogo.`);
      setTimeout(() => setStatusMsg(''), 3500);
    }
  };

  const handleCountScan = async (rawCode: string) => {
    const found = await findProductByScan(rawCode);
    if (found) {
      if (scannerCfg.beep_on_scan) playScanBeep('success');
      setPhysicalCounts((prev) => {
        const cur = Number(prev[found.id] || 0);
        return { ...prev, [found.id]: String(cur + 1) };
      });
      setLastCountScannedId(found.id);
      setCountScanInput('');
      setStatusMsg(`Conteo +1: ${found.name}`);
      setTimeout(() => setStatusMsg(''), 2500);
    } else {
      if (scannerCfg.beep_on_scan) playScanBeep('error');
      setStatusMsg(`Código "${rawCode}" no registrado.`);
      setTimeout(() => setStatusMsg(''), 3500);
    }
  };

  const filtered = products.filter((p) => {
    if (catFilter !== 'Todas' && p.category !== catFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.internal_code.toLowerCase().includes(q) ||
      p.barcode.toLowerCase().includes(q) ||
      (p.barcodes || []).some((b) => b.code.toLowerCase().includes(q))
    );
  });

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProd) return;
    setProdFormError('');
    try {
      if (editingProd.id) {
        await apiFetch(`/api/products/${editingProd.id}`, {
          method: 'PUT',
          body: JSON.stringify(editingProd),
        });
      } else {
        await apiFetch('/api/products', {
          method: 'POST',
          body: JSON.stringify(editingProd),
        });
      }
      setEditingProd(null);
      onRefresh();
      loadMovements();
    } catch (err: any) {
      setProdFormError(err.message);
    }
  };

  const handleAddExtraBarcode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeModalProd) return;
    setBcError('');
    try {
      await apiFetch(`/api/products/${barcodeModalProd.id}/barcodes`, {
        method: 'POST',
        body: JSON.stringify({
          code: newBcCode,
          code_type: newBcType,
          presentation_label: newBcPres || barcodeModalProd.presentation,
          price_override: newBcPrice ? Number(newBcPrice) : null,
        }),
      });
      setNewBcCode('');
      setNewBcPres('');
      setNewBcPrice('');
      onRefresh();
    } catch (err: any) {
      setBcError(err.message);
    }
  };

  const handleGenerateInternalCode = async (prodId: number) => {
    setBcError('');
    try {
      await apiFetch(`/api/products/${prodId}/generate-internal-barcode`, { method: 'POST' });
      onRefresh();
    } catch (err: any) {
      setBcError(err.message);
    }
  };

  const handleDeleteExtraBarcode = async (prodId: number, barcodeId: number) => {
    await apiFetch(`/api/products/${prodId}/barcodes/${barcodeId}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleToggleActive = async (prod: Product) => {
    await apiFetch(`/api/products/${prod.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: prod.is_active === 1 ? 0 : 1 }),
    });
    onRefresh();
  };

  const openPriceHistory = async (prod: Product) => {
    const items = await apiFetch<PriceHistory[]>(`/api/products/${prod.id}/price-history`);
    setPriceHistory({ prodName: prod.name, items });
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
    const mapped = rows.map((r) => ({
      internal_code: r.codigo || r.internal_code || r.SKU,
      barcode: r.codigo_barras || r.barcode || '',
      name: r.nombre || r.name,
      description: r.descripcion || r.description || '',
      brand: r.marca || r.brand || '',
      presentation: r.presentacion || r.presentation || '',
      category: r.categoria || r.category || 'Abarrotes',
      purchase_price: Number(r.precio_compra || r.purchase_price || 0),
      sale_price: Number(r.precio_venta || r.sale_price || 0),
      stock: Number(r.existencias || r.stock || 0),
      min_stock: Number(r.stock_minimo || r.min_stock || 5),
    }));
    const res = await apiFetch<{ imported: number; updated: number }>('/api/products/import', {
      method: 'POST',
      body: JSON.stringify({ rows: mapped }),
    });
    setStatusMsg(`Importación Excel completada: ${res.imported} nuevos, ${res.updated} actualizados.`);
    setTimeout(() => setStatusMsg(''), 4000);
    onRefresh();
  };

  const downloadExcelTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        codigo: 'LP-099',
        codigo_barras: '7401009999991',
        nombre: 'Ejemplo Azúcar Morena 2 lb',
        descripcion: 'Azúcar de caña nacional',
        marca: 'Cañaveral',
        presentacion: 'Bolsa 2 lb',
        categoria: 'Abarrotes',
        precio_compra: 24,
        precio_venta: 34,
        existencias: 30,
        stock_minimo: 8,
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'Plantilla_Importacion_Productos.xlsx');
  };

  const handleAdjustInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify({
        product_id: adjProdId,
        type: adjType,
        quantity: Number(adjQty),
        reason: adjReason,
        batch_expiry: adjExpiry || null,
      }),
    });
    setAdjReason('');
    setAdjQty('1');
    setStatusMsg('Movimiento de inventario registrado.');
    setTimeout(() => setStatusMsg(''), 3000);
    onRefresh();
    loadMovements();
  };

  const handleApplyPhysicalCount = async () => {
    const counts = Object.entries(physicalCounts)
      .filter(([, v]) => v !== '')
      .map(([id, v]) => ({ product_id: Number(id), counted_stock: Number(v), notes: 'Conteo físico con escáner' }));
    if (counts.length === 0) return;
    const res = await apiFetch<{ adjusted: number }>('/api/inventory/physical-count', {
      method: 'POST',
      body: JSON.stringify({ counts }),
    });
    setPhysicalCounts({});
    setLastCountScannedId(null);
    setStatusMsg(`Conteo físico aplicado: ${res.adjusted} productos ajustados.`);
    setTimeout(() => setStatusMsg(''), 4000);
    onRefresh();
    loadMovements();
  };

  const handleProductImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingProd) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditingProd({ ...editingProd, image_url: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const lowOrOut = products.filter((p) => p.is_active === 1 && p.stock <= p.min_stock);
  const expiring = products.filter((p) => {
    if (!p.expiry_date || p.is_active !== 1) return false;
    const diffDays = (new Date(p.expiry_date).getTime() - Date.now()) / (1000 * 3600 * 24);
    return diffDays <= 45;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Productos, Códigos de Barras e Inventario</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            Múltiples códigos por producto, códigos internos sin duplicados, escáner en entradas, conteos y consultas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadExcelTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Plantilla Excel
          </button>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#202633] bg-white border border-[#202633]/15 hover:bg-[#FFF4E5] rounded-lg cursor-pointer whitespace-nowrap shrink-0">
            <Upload className="w-3.5 h-3.5" />
            Importar Excel
            <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="hidden" />
          </label>
          <button
            type="button"
            onClick={() => {
              setProdFormError('');
              setEditingProd({
                internal_code: `LP-${String(products.length + 1).padStart(3, '0')}`,
                barcode: '',
                name: '',
                description: '',
                brand: '',
                presentation: '',
                category: 'Abarrotes',
                purchase_price: 0,
                sale_price: 0,
                tax_rate: 0,
                stock: 0,
                min_stock: 5,
                expiry_date: '',
                image_url: '',
                is_featured: 0,
                is_bestseller: 0,
                is_active: 1,
              });
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo producto
          </button>
        </div>
      </div>

      {/* Quick Barcode Stock Lookup Bar */}
      <div className="bg-white border border-[#202633]/12 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <span className="text-xs font-semibold text-[#202633] whitespace-nowrap">Consultar existencias por código:</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLookupScan(lookupScanInput);
            }}
            className="relative flex-1"
          >
            <Barcode className="w-4 h-4 text-[#2054C9] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={lookupScanInput}
              onChange={(e) => setLookupScanInput(e.target.value)}
              placeholder="Escanear código comercial o código interno + Enter..."
              className="w-full pl-9 pr-24 py-2 text-xs font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-[#2054C9] hover:bg-[#1943A3] text-white text-[11px] font-semibold rounded"
            >
              Consultar
            </button>
          </form>
          {scannerCfg.camera_enabled && (
            <button
              type="button"
              onClick={() => setCameraTarget('lookup')}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] text-xs font-semibold rounded-lg whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5" />
              Escanear con cámara
            </button>
          )}
        </div>

        {lookupError && <p className="text-xs text-red-700 font-medium">{lookupError}</p>}

        {lookupResult && (
          <div className="p-3 bg-[#FFF4E5]/60 border border-[#202633]/12 rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs">
            <div>
              <span className="font-bold text-[#202633]">{lookupResult.name}</span>
              <span className="text-[#202633]/65 ml-2">
                {lookupResult.presentation} · SKU <span className="font-mono">{lookupResult.internal_code}</span>
              </span>
            </div>
            <div className="flex items-center gap-5">
              <span>
                Precio: <strong className="font-sans tabular-nums text-[#2054C9]">{formatCurrency(lookupResult.sale_price)}</strong>
              </span>
              <span>
                Existencias:{' '}
                <strong className={`font-sans tabular-nums ${lookupResult.stock <= lookupResult.min_stock ? 'text-[#8A6D00]' : 'text-[#0A7830]'}`}>
                  {lookupResult.stock}
                </strong>
              </span>
              {lookupResult.expiry_date && <span className="font-mono">Vence: {lookupResult.expiry_date}</span>}
              <button
                type="button"
                onClick={() => setLookupResult(null)}
                className="text-[#202633]/60 hover:text-[#202633] font-semibold"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>

      {statusMsg && (
        <div className="p-3 bg-[#13B64B]/12 border border-[#13B64B]/30 text-[#0A7830] font-semibold text-xs rounded-lg">{statusMsg}</div>
      )}

      <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg w-fit overflow-x-auto max-w-full">
        {[
          ['productos', `Catálogo y códigos (${products.length})`],
          ['movimientos', 'Entradas, salidas y ajustes'],
          ['conteo', 'Conteo físico con escáner'],
          ['alertas', `Alertas (${lowOrOut.length + expiring.length})`],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSubTab(k as any)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === k ? 'bg-[#2054C9] text-white' : 'text-[#202633]/70 hover:text-[#202633]'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {subTab === 'productos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, SKU o cualquier código de barras asociado..."
              className="flex-1 px-3.5 py-2 text-xs border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
            />
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
            >
              <option value="Todas">Todas las categorías</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                    <th className="py-3 px-4 font-semibold">SKU / Códigos</th>
                    <th className="py-3 px-4 font-semibold">Producto</th>
                    <th className="py-3 px-4 font-semibold">Categoría</th>
                    <th className="py-3 px-4 font-semibold text-right">Compra</th>
                    <th className="py-3 px-4 font-semibold text-right">Venta</th>
                    <th className="py-3 px-4 font-semibold text-right">Stock</th>
                    <th className="py-3 px-4 font-semibold">Estado</th>
                    <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const bcCount = (p.barcodes || []).length;
                    return (
                      <tr key={p.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                        <td className="py-3 px-4 font-mono">
                          <div className="font-semibold text-[#202633]">{p.internal_code}</div>
                          <div className="text-[11px] text-[#202633]/55">
                            {p.barcode || 'Sin código comercial'} · {bcCount} reg.
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#202633]">{p.name}</div>
                          <div className="text-[11px] text-[#202633]/60">
                            {p.brand} · {p.presentation}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#202633]/70">{p.category}</td>
                        <td className="py-3 px-4 text-right font-sans tabular-nums text-[#202633]/70">
                          {formatCurrency(p.purchase_price)}
                        </td>
                        <td className="py-3 px-4 text-right font-sans tabular-nums font-bold text-[#202633]">
                          {formatCurrency(p.sale_price)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-sans tabular-nums font-bold ${
                            p.stock <= 0 ? 'text-red-700' : p.stock <= p.min_stock ? 'text-[#8A6D00]' : 'text-[#0A7830]'
                          }`}
                        >
                          {p.stock}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(p)}
                            className={`text-xs font-semibold ${p.is_active === 1 ? 'text-[#0A7830]' : 'text-[#202633]/40'}`}
                          >
                            {p.is_active === 1 ? 'Activo' : 'Inactivo'}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setBcError('');
                              setBarcodeModalProdId(p.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[#202633] bg-[#FFF4E5] hover:bg-[#F9D94A]/40 rounded font-semibold"
                            title="Gestionar códigos de barras y etiquetas"
                          >
                            <Barcode className="w-3.5 h-3.5" />
                            Códigos
                          </button>
                          <button
                            type="button"
                            onClick={() => openPriceHistory(p)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[#202633]/70 hover:text-[#202633] bg-[#FFF4E5]/60 hover:bg-[#FFF4E5] rounded"
                            title="Historial de precios"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setProdFormError('');
                              setEditingProd(p);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[#2054C9] bg-[#2054C9]/10 hover:bg-[#2054C9]/15 rounded font-semibold"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'movimientos' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[#202633] font-sans">
                Registrar entrada, salida, ajuste autorizado o pérdida con escáner
              </h3>
              <div className="flex items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAdjScan(adjScanInput);
                  }}
                  className="relative"
                >
                  <Barcode className="w-3.5 h-3.5 text-[#2054C9] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={adjScanInput}
                    onChange={(e) => setAdjScanInput(e.target.value)}
                    placeholder="Escanear producto + Enter"
                    className="pl-8 pr-3 py-1.5 text-xs font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
                  />
                </form>
                {scannerCfg.camera_enabled && (
                  <button
                    type="button"
                    onClick={() => setCameraTarget('adjust')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] rounded-lg"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Cámara
                  </button>
                )}
              </div>
            </div>

            <form onSubmit={handleAdjustInventory} className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
              <select
                value={adjProdId}
                onChange={(e) => setAdjProdId(Number(e.target.value))}
                className="sm:col-span-4 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.internal_code} - {p.name} (Stock: {p.stock})
                  </option>
                ))}
              </select>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as any)}
                className="sm:col-span-2 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                <option value="entrada">Entrada (+)</option>
                <option value="salida">Salida (-)</option>
                <option value="ajuste">Ajuste (+/-)</option>
                <option value="perdida_danado">Pérdida / Dañado (-)</option>
              </select>
              <input
                type="number"
                required
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                placeholder="Cant."
                className="sm:col-span-1 px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="date"
                value={adjExpiry}
                onChange={(e) => setAdjExpiry(e.target.value)}
                title="Fecha de vencimiento (opcional)"
                className="sm:col-span-2 px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="text"
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="Motivo o documento..."
                className="sm:col-span-2 px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <button
                type="submit"
                className="sm:col-span-1 py-2 px-3 bg-[#2054C9] hover:bg-[#1943A3] text-white font-semibold rounded-lg"
              >
                Aplicar
              </button>
            </form>
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-3 px-4 font-semibold">Fecha</th>
                  <th className="py-3 px-4 font-semibold">Producto</th>
                  <th className="py-3 px-4 font-semibold">Tipo</th>
                  <th className="py-3 px-4 font-semibold text-right">Delta</th>
                  <th className="py-3 px-4 font-semibold text-right">Resultante</th>
                  <th className="py-3 px-4 font-semibold">Motivo</th>
                  <th className="py-3 px-4 font-semibold">Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                    <td className="py-2.5 px-4 font-mono text-[#202633]/65">{m.created_at}</td>
                    <td className="py-2.5 px-4 font-semibold text-[#202633]">{m.product_name}</td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{m.type}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-sans tabular-nums font-bold ${
                        m.quantity_delta >= 0 ? 'text-[#0A7830]' : 'text-red-700'
                      }`}
                    >
                      {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                    </td>
                    <td className="py-2.5 px-4 text-right font-sans tabular-nums font-semibold">{m.new_stock}</td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{m.reason}</td>
                    <td className="py-2.5 px-4 text-[#202633]/70">{m.user_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'conteo' && (
        <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#202633]/12 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#202633] font-sans flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[#2054C9]" />
                Conteo físico de inventario asistido por escáner
              </h3>
              <p className="text-xs text-[#202633]/65">
                Cada escaneo suma +1 al conteo físico del producto. También puedes digitar cantidades manualmente.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCountScan(countScanInput);
                }}
                className="relative"
              >
                <Barcode className="w-3.5 h-3.5 text-[#2054C9] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={countScanInput}
                  onChange={(e) => setCountScanInput(e.target.value)}
                  placeholder="Escanear producto (+1)..."
                  className="pl-8 pr-3 py-2 text-xs font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </form>
              {scannerCfg.camera_enabled && (
                <button
                  type="button"
                  onClick={() => setCameraTarget('count')}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] rounded-lg"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Cámara
                </button>
              )}
              <button
                type="button"
                onClick={handleApplyPhysicalCount}
                className="px-4 py-2 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] text-xs font-bold rounded-lg"
              >
                Aplicar conteo físico
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-3 px-4 font-semibold">SKU / Código</th>
                  <th className="py-3 px-4 font-semibold">Producto</th>
                  <th className="py-3 px-4 font-semibold text-right">Stock sistema</th>
                  <th className="py-3 px-4 font-semibold text-right">Conteo físico</th>
                  <th className="py-3 px-4 font-semibold text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter((p) => p.is_active === 1)
                  .map((p) => {
                    const val = physicalCounts[p.id] ?? '';
                    const diff = val !== '' ? Number(val) - p.stock : null;
                    const highlighted = lastCountScannedId === p.id;
                    return (
                      <tr key={p.id} className={`border-b border-[#202633]/8 ${highlighted ? 'bg-[#F9D94A]/20' : ''}`}>
                        <td className="py-2.5 px-4 font-mono text-[#202633]">
                          {p.internal_code}
                          {p.barcode ? <span className="text-[#202633]/45 ml-1.5">· {p.barcode}</span> : null}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-[#202633]">{p.name}</td>
                        <td className="py-2.5 px-4 text-right font-sans tabular-nums">{p.stock}</td>
                        <td className="py-2.5 px-4 text-right">
                          <input
                            type="number"
                            min={0}
                            placeholder={String(p.stock)}
                            value={val}
                            onChange={(e) => setPhysicalCounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-24 px-2 py-1 text-right font-sans tabular-nums font-semibold border border-[#202633]/20 rounded bg-white text-[#202633]"
                          />
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-sans tabular-nums font-bold ${
                            diff === null || diff === 0 ? 'text-[#202633]/40' : diff > 0 ? 'text-[#0A7830]' : 'text-red-700'
                          }`}
                        >
                          {diff === null ? '—' : diff > 0 ? `+${diff}` : diff}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'alertas' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-3">
            <h3 className="text-sm font-bold text-[#202633] font-sans flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#8A6D00]" />
              Inventario bajo o agotado ({lowOrOut.length})
            </h3>
            {lowOrOut.map((p) => (
              <div key={p.id} className="flex justify-between py-2 border-b border-[#202633]/8 text-xs">
                <span className="font-semibold text-[#202633]">{p.name}</span>
                <span className={`font-sans tabular-nums font-bold ${p.stock <= 0 ? 'text-red-700' : 'text-[#8A6D00]'}`}>
                  Stock: {p.stock} (Mín: {p.min_stock})
                </span>
              </div>
            ))}
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl p-6 space-y-3">
            <h3 className="text-sm font-bold text-[#202633] font-sans">
              Control de vencimientos próximos ({expiring.length})
            </h3>
            {expiring.map((p) => (
              <div key={p.id} className="flex justify-between py-2 border-b border-[#202633]/8 text-xs">
                <span className="font-semibold text-[#202633]">{p.name}</span>
                <span className="font-mono font-semibold text-[#8A6D00]">Vence: {p.expiry_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Multi-Barcode Manager Modal */}
      {barcodeModalProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4 overflow-y-auto">
          <div className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-[#202633]/12 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#202633] font-sans">
                  Códigos de barras · {barcodeModalProd.name}
                </h3>
                <p className="text-xs text-[#202633]/65 mt-0.5">
                  Presentación base: {barcodeModalProd.presentation} · Precio base:{' '}
                  <span className="font-sans font-bold text-[#2054C9]">{formatCurrency(barcodeModalProd.sale_price)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleGenerateInternalCode(barcodeModalProd.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[#F9D94A] hover:bg-[#F2CE30] text-[#202633] rounded-lg shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generar código interno EAN-13
              </button>
            </div>

            <div className="border border-[#202633]/12 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#FFF4E5]/60 border-b border-[#202633]/12 text-[#202633]/70">
                    <th className="py-2.5 px-3 font-semibold">Código</th>
                    <th className="py-2.5 px-3 font-semibold">Tipo</th>
                    <th className="py-2.5 px-3 font-semibold">Presentación</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Precio</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(barcodeModalProd.barcodes || []).map((b) => (
                    <tr key={b.id} className="border-b border-[#202633]/8">
                      <td className="py-2.5 px-3 font-mono font-semibold text-[#202633]">{b.code}</td>
                      <td className="py-2.5 px-3 capitalize text-[#202633]/70">{b.code_type}</td>
                      <td className="py-2.5 px-3 text-[#202633]/80">{b.presentation_label || barcodeModalProd.presentation}</td>
                      <td className="py-2.5 px-3 text-right font-sans tabular-nums font-bold text-[#202633]">
                        {b.price_override !== null && b.price_override !== undefined
                          ? formatCurrency(b.price_override)
                          : formatCurrency(barcodeModalProd.sale_price)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() =>
                            setLabelPreview({
                              product: barcodeModalProd,
                              code: b.code,
                              presentation: b.presentation_label || barcodeModalProd.presentation,
                              price: b.price_override ?? barcodeModalProd.sale_price,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] font-semibold rounded"
                          title="Imprimir etiqueta"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Etiqueta
                        </button>
                        {b.code !== barcodeModalProd.internal_code && (
                          <button
                            type="button"
                            onClick={() => handleDeleteExtraBarcode(barcodeModalProd.id, b.id)}
                            className="p-1 text-[#202633]/40 hover:text-red-700"
                            title="Desvincular código"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={handleAddExtraBarcode} className="p-4 bg-[#FFF4E5]/60 border border-[#202633]/12 rounded-xl space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-bold text-[#202633]">Asociar otro código de barras (comercial o interno)</p>
                {scannerCfg.camera_enabled && (
                  <button
                    type="button"
                    onClick={() => setCameraTarget('add_bc')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-[#202633]/20 text-[#202633] font-semibold rounded-md hover:bg-[#FFF4E5]"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Escanear con cámara
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  required
                  value={newBcCode}
                  onChange={(e) => setNewBcCode(e.target.value)}
                  placeholder="Escanear o escribir código *"
                  className="sm:col-span-4 px-3 py-2 font-mono border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                />
                <select
                  value={newBcType}
                  onChange={(e) => setNewBcType(e.target.value as any)}
                  className="sm:col-span-2 px-2.5 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  <option value="comercial">Comercial</option>
                  <option value="interno">Interno</option>
                </select>
                <input
                  type="text"
                  value={newBcPres}
                  onChange={(e) => setNewBcPres(e.target.value)}
                  placeholder="Presentación (Ej. Pack x6)"
                  className="sm:col-span-3 px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                />
                <input
                  type="number"
                  step="0.01"
                  value={newBcPrice}
                  onChange={(e) => setNewBcPrice(e.target.value)}
                  placeholder="Precio opc."
                  className="sm:col-span-2 px-3 py-2 font-sans tabular-nums border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                />
                <button
                  type="submit"
                  className="sm:col-span-1 py-2 px-2 bg-[#2054C9] hover:bg-[#1943A3] text-white font-semibold rounded-lg"
                >
                  +
                </button>
              </div>
              {bcError && <p className="text-red-700 font-semibold">{bcError}</p>}
            </form>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setBarcodeModalProdId(null)}
                className="px-4 py-2 text-xs font-semibold bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] rounded-lg"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Form Modal */}
      {editingProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-base font-bold text-[#202633] font-sans">
              {editingProd.id ? 'Editar producto' : 'Registrar nuevo producto'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Código interno único *</label>
                <input
                  type="text"
                  required
                  value={editingProd.internal_code || ''}
                  onChange={(e) => setEditingProd({ ...editingProd, internal_code: e.target.value })}
                  className="w-full px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Código de barras comercial</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={editingProd.barcode || ''}
                    onChange={(e) => setEditingProd({ ...editingProd, barcode: e.target.value })}
                    placeholder="Opcional si no tiene"
                    className="w-full px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
                  />
                  {scannerCfg.camera_enabled && (
                    <button
                      type="button"
                      onClick={() => setCameraTarget('edit_prod')}
                      className="px-2.5 py-2 bg-[#FFF4E5] hover:bg-[#F9D94A]/40 border border-[#202633]/20 rounded-lg shrink-0"
                      title="Escanear código con cámara"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#202633]" />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Categoría *</label>
                <select
                  value={editingProd.category || 'Abarrotes'}
                  onChange={(e) => setEditingProd({ ...editingProd, category: e.target.value as ProductCategory })}
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Nombre del producto *</label>
                <input
                  type="text"
                  required
                  value={editingProd.name || ''}
                  onChange={(e) => setEditingProd({ ...editingProd, name: e.target.value })}
                  className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-[#202633]/80 mb-1">Marca</label>
                  <input
                    type="text"
                    value={editingProd.brand || ''}
                    onChange={(e) => setEditingProd({ ...editingProd, brand: e.target.value })}
                    className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#202633]/80 mb-1">Presentación</label>
                  <input
                    type="text"
                    value={editingProd.presentation || ''}
                    onChange={(e) => setEditingProd({ ...editingProd, presentation: e.target.value })}
                    className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                  />
                </div>
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-semibold text-[#202633]/80 mb-1">Descripción</label>
              <textarea
                rows={2}
                value={editingProd.description || ''}
                onChange={(e) => setEditingProd({ ...editingProd, description: e.target.value })}
                className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Precio compra</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editingProd.purchase_price ?? 0}
                  onChange={(e) => setEditingProd({ ...editingProd, purchase_price: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Precio venta</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editingProd.sale_price ?? 0}
                  onChange={(e) => setEditingProd({ ...editingProd, sale_price: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              {!editingProd.id && (
                <div>
                  <label className="block font-semibold text-[#202633]/80 mb-1">Stock inicial</label>
                  <input
                    type="number"
                    value={editingProd.stock ?? 0}
                    onChange={(e) => setEditingProd({ ...editingProd, stock: Number(e.target.value) })}
                    className="w-full px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
                  />
                </div>
              )}
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Stock mínimo</label>
                <input
                  type="number"
                  value={editingProd.min_stock ?? 5}
                  onChange={(e) => setEditingProd({ ...editingProd, min_stock: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-center">
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Fecha de vencimiento</label>
                <input
                  type="date"
                  value={editingProd.expiry_date || ''}
                  onChange={(e) => setEditingProd({ ...editingProd, expiry_date: e.target.value })}
                  className="w-full px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#202633]/80 mb-1">Fotografía del producto</label>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-2 bg-[#FFF4E5] hover:bg-[#F9D94A]/40 text-[#202633] font-semibold rounded-lg cursor-pointer whitespace-nowrap">
                    Subir foto
                    <input type="file" accept="image/*" onChange={handleProductImageUpload} className="hidden" />
                  </label>
                  <input
                    type="text"
                    placeholder="o URL de imagen"
                    value={editingProd.image_url || ''}
                    onChange={(e) => setEditingProd({ ...editingProd, image_url: e.target.value })}
                    className="flex-1 px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs pt-2 text-[#202633]">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(editingProd.is_featured)}
                  onChange={(e) => setEditingProd({ ...editingProd, is_featured: e.target.checked ? 1 : 0 })}
                />
                <span>Producto destacado</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(editingProd.is_bestseller)}
                  onChange={(e) => setEditingProd({ ...editingProd, is_bestseller: e.target.checked ? 1 : 0 })}
                />
                <span>Más vendido</span>
              </label>
            </div>

            {prodFormError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {prodFormError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-[#202633]/12">
              <button
                type="button"
                onClick={() => setEditingProd(null)}
                className="px-4 py-2 text-xs font-medium text-[#202633] bg-[#FFF4E5] rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg"
              >
                Guardar producto
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Price History Modal */}
      {priceHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
          <div className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#202633] font-sans">
                Historial de precios · {priceHistory.prodName}
              </h3>
              <button type="button" onClick={() => setPriceHistory(null)} className="text-xs font-semibold text-[#202633]/65">
                Cerrar
              </button>
            </div>
            {priceHistory.items.length === 0 ? (
              <p className="text-xs text-[#202633]/60 py-4">Sin cambios de precio registrados.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#202633]/12 text-[#202633]/65">
                    <th className="py-2 font-semibold">Fecha</th>
                    <th className="py-2 text-right font-semibold">Compra ant. → nueva</th>
                    <th className="py-2 text-right font-semibold">Venta ant. → nueva</th>
                    <th className="py-2 pl-3 font-semibold">Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.items.map((h) => (
                    <tr key={h.id} className="border-b border-[#202633]/8">
                      <td className="py-2 font-mono text-[#202633]/70">{h.changed_at}</td>
                      <td className="py-2 text-right font-sans tabular-nums">
                        {formatCurrency(h.old_purchase_price)} → {formatCurrency(h.new_purchase_price)}
                      </td>
                      <td className="py-2 text-right font-sans tabular-nums font-bold text-[#2054C9]">
                        {formatCurrency(h.old_sale_price)} → {formatCurrency(h.new_sale_price)}
                      </td>
                      <td className="py-2 pl-3 text-[#202633]">{h.changed_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {cameraTarget && (
        <CameraBarcodeModal
          preferredFacing={scannerCfg.preferred_camera_facing}
          onDetected={(code) => {
            const target = cameraTarget;
            setCameraTarget(null);
            if (target === 'edit_prod' && editingProd) {
              setEditingProd({ ...editingProd, barcode: code });
            } else if (target === 'add_bc') {
              setNewBcCode(code);
            } else if (target === 'lookup') {
              handleLookupScan(code);
            } else if (target === 'adjust') {
              handleAdjScan(code);
            } else if (target === 'count') {
              handleCountScan(code);
            }
          }}
          onClose={() => setCameraTarget(null)}
        />
      )}

      {labelPreview && (
        <BarcodeLabelModal
          product={labelPreview.product}
          code={labelPreview.code}
          presentation={labelPreview.presentation}
          price={labelPreview.price}
          onClose={() => setLabelPreview(null)}
        />
      )}
    </div>
  );
};
