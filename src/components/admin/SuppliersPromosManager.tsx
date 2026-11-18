import React, { useEffect, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { PRODUCT_CATEGORIES, type Product, type Promotion, type Purchase, type Supplier } from '../../types';
import { apiFetch, formatCurrency } from '../../lib/api';

interface Props {
  products: Product[];
  onRefreshAll: () => void;
}

export const SuppliersPromosManager: React.FC<Props> = ({ products, onRefreshAll }) => {
  const [subTab, setSubTab] = useState<'compras' | 'proveedores' | 'promociones'>('compras');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  // New Supplier
  const [supModal, setSupModal] = useState(false);
  const [supForm, setSupForm] = useState({ name: '', rtn: '', contact_name: '', phone: '', email: '', products_supplied: '' });

  // New Purchase
  const [purchModal, setPurchModal] = useState(false);
  const [purchSupId, setPurchSupId] = useState<number>(0);
  const [purchDoc, setPurchDoc] = useState('');
  const [purchDate, setPurchDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchConfirmNow, setPurchConfirmNow] = useState(true);
  const [purchItems, setPurchItems] = useState<{ product_id: number; quantity: number; unit_cost: number; batch_expiry: string }[]>([]);

  // New Promotion
  const [promoModal, setPromoModal] = useState(false);
  const [promoForm, setPromoForm] = useState<Partial<Promotion>>({
    title: '',
    description: '',
    scope: 'category',
    target_category: 'Snacks y golosinas',
    target_product_id: products[0]?.id || null,
    discount_type: 'percentage',
    discount_value: 10,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '2027-12-31',
    publish_in_app: 1,
    is_active: 1,
  });

  const load = async () => {
    const [sRes, pRes, prRes] = await Promise.all([
      apiFetch<Supplier[]>('/api/suppliers').catch(() => []),
      apiFetch<Purchase[]>('/api/purchases').catch(() => []),
      apiFetch<Promotion[]>('/api/promotions').catch(() => []),
    ]);
    setSuppliers(sRes);
    setPurchases(pRes);
    setPromotions(prRes);
    if (sRes.length > 0 && !purchSupId) setPurchSupId(sRes[0].id);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(supForm) });
    setSupModal(false);
    setSupForm({ name: '', rtn: '', contact_name: '', phone: '', email: '', products_supplied: '' });
    load();
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purchItems.length === 0) return;
    await apiFetch('/api/purchases', {
      method: 'POST',
      body: JSON.stringify({
        supplier_id: purchSupId,
        document_number: purchDoc,
        purchase_date: purchDate,
        confirm_immediately: purchConfirmNow,
        items: purchItems,
      }),
    });
    setPurchModal(false);
    setPurchItems([]);
    setPurchDoc('');
    load();
    onRefreshAll();
  };

  const handleConfirmPurchase = async (id: number) => {
    await apiFetch(`/api/purchases/${id}/confirm`, { method: 'POST' });
    load();
    onRefreshAll();
  };

  const handleSavePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/promotions', { method: 'POST', body: JSON.stringify(promoForm) });
    setPromoModal(false);
    load();
    onRefreshAll();
  };

  const togglePromoActive = async (promo: Promotion) => {
    await apiFetch(`/api/promotions/${promo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...promo, is_active: promo.is_active === 1 ? 0 : 1 }),
    });
    load();
    onRefreshAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl text-[#202633] font-display">Proveedores, Compras y Promociones</h2>
          <p className="text-xs text-[#202633]/65 mt-0.5">
            Abastecimiento con actualización automática de stock y promociones por producto o categoría.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-white border border-[#202633]/12 rounded-lg w-fit">
          {[
            ['compras', `Compras (${purchases.length})`],
            ['proveedores', `Proveedores (${suppliers.length})`],
            ['promociones', `Promociones (${promotions.length})`],
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
      </div>

      {subTab === 'compras' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setPurchItems([
                  { product_id: products[0]?.id || 1, quantity: 10, unit_cost: products[0]?.purchase_price || 20, batch_expiry: '' },
                ]);
                setPurchModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Registrar compra
            </button>
          </div>

          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-3 px-4 font-semibold">Documento</th>
                  <th className="py-3 px-4 font-semibold">Proveedor</th>
                  <th className="py-3 px-4 font-semibold">Fecha</th>
                  <th className="py-3 px-4 font-semibold">Estado</th>
                  <th className="py-3 px-4 font-semibold text-right">Total costo</th>
                  <th className="py-3 px-4 font-semibold text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                    <td className="py-3 px-4 font-mono font-semibold text-[#202633]">{p.document_number}</td>
                    <td className="py-3 px-4 text-[#202633]">{p.supplier_name}</td>
                    <td className="py-3 px-4 font-mono text-[#202633]/65">{p.purchase_date}</td>
                    <td className="py-3 px-4">
                      {p.status === 'confirmada' ? (
                        <span className="text-[#0A7830] font-semibold">Confirmada (En stock)</span>
                      ) : (
                        <span className="text-[#8A6D00] font-semibold">Pendiente</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-sans tabular-nums font-bold text-[#202633]">{formatCurrency(p.total_cost)}</td>
                    <td className="py-3 px-4 text-right">
                      {p.status === 'pendiente' && (
                        <button
                          type="button"
                          onClick={() => handleConfirmPurchase(p.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#13B64B] hover:bg-[#10A041] text-[#202633] rounded font-bold"
                        >
                          <Check className="w-3 h-3" />
                          Confirmar ingreso
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'proveedores' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSupModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Nuevo proveedor
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suppliers.map((s) => (
              <div key={s.id} className="bg-white border border-[#202633]/12 rounded-xl p-5 space-y-2 text-xs">
                <div className="flex justify-between items-start">
                  <h4 className="text-sm font-bold text-[#202633] font-sans">{s.name}</h4>
                  <span className="font-mono text-[#202633]/55">{s.rtn ? `ID: ${s.rtn}` : ''}</span>
                </div>
                <p className="text-[#202633]/75">
                  Contacto: {s.contact_name} · {s.phone} · {s.email}
                </p>
                <p className="text-[#202633]/60 pt-2 border-t border-[#202633]/8">Suministra: {s.products_supplied}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'promociones' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#202633]/65">
              Ofertas directas por producto o categoría visibles en tienda y punto de venta.
            </p>
            <button
              type="button"
              onClick={() => setPromoModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2054C9] hover:bg-[#1943A3] rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Crear promoción
            </button>
          </div>
          <div className="bg-white border border-[#202633]/12 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202633]/12 bg-[#FFF4E5]/60 text-[#202633]/70">
                  <th className="py-3 px-4 font-semibold">Promoción</th>
                  <th className="py-3 px-4 font-semibold">Alcance</th>
                  <th className="py-3 px-4 font-semibold">Beneficio</th>
                  <th className="py-3 px-4 font-semibold">Vigencia</th>
                  <th className="py-3 px-4 font-semibold text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((pr) => (
                  <tr key={pr.id} className="border-b border-[#202633]/8 hover:bg-[#FFF4E5]/40">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#202633]">{pr.title}</div>
                      <div className="text-[11px] text-[#202633]/60">{pr.description}</div>
                    </td>
                    <td className="py-3 px-4 text-[#202633]/75">
                      {pr.scope === 'category' ? `Categoría: ${pr.target_category}` : `Producto: ${pr.target_product_name}`}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-0.5 bg-[#F9D94A] text-[#202633] font-sans font-bold tabular-nums rounded">
                        {pr.discount_type === 'percentage' ? `-${pr.discount_value}%` : `Precio ${formatCurrency(pr.discount_value)}`}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[#202633]/65">
                      {pr.start_date} al {pr.end_date}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => togglePromoActive(pr)}
                        className={`px-3 py-1 rounded text-xs font-semibold ${
                          pr.is_active === 1 ? 'bg-[#13B64B]/12 text-[#0A7830]' : 'bg-[#202633]/8 text-[#202633]/60'
                        }`}
                      >
                        {pr.is_active === 1 ? 'Activa' : 'Pausada'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      {supModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
          <form onSubmit={handleSaveSupplier} className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-md p-6 space-y-3 text-xs">
            <h3 className="text-base font-bold text-[#202633] font-sans">Registrar proveedor</h3>
            <input
              type="text"
              required
              placeholder="Nombre o razón social *"
              value={supForm.name}
              onChange={(e) => setSupForm({ ...supForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Identificación / Código"
                value={supForm.rtn}
                onChange={(e) => setSupForm({ ...supForm, rtn: e.target.value })}
                className="px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="text"
                placeholder="Contacto"
                value={supForm.contact_name}
                onChange={(e) => setSupForm({ ...supForm, contact_name: e.target.value })}
                className="px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Teléfono"
                value={supForm.phone}
                onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                className="px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="email"
                placeholder="Correo"
                value={supForm.email}
                onChange={(e) => setSupForm({ ...supForm, email: e.target.value })}
                className="px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <input
              type="text"
              placeholder="Productos suministrados"
              value={supForm.products_supplied}
              onChange={(e) => setSupForm({ ...supForm, products_supplied: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setSupModal(false)} className="px-4 py-2 bg-[#FFF4E5] text-[#202633] font-medium rounded-lg">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white rounded-lg font-semibold">
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Purchase Modal */}
      {purchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
          <form onSubmit={handleSavePurchase} className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-2xl p-6 space-y-4 text-xs">
            <h3 className="text-base font-bold text-[#202633] font-sans">Registrar compra a proveedor</h3>
            <div className="grid grid-cols-3 gap-3">
              <select
                value={purchSupId}
                onChange={(e) => setPurchSupId(Number(e.target.value))}
                className="px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="N.º Documento / Factura"
                value={purchDoc}
                onChange={(e) => setPurchDoc(e.target.value)}
                className="px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="date"
                value={purchDate}
                onChange={(e) => setPurchDate(e.target.value)}
                className="px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {purchItems.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={it.product_id}
                    onChange={(e) => {
                      const next = [...purchItems];
                      next[idx].product_id = Number(e.target.value);
                      setPurchItems(next);
                    }}
                    className="col-span-5 px-2 py-1.5 border border-[#202633]/20 rounded bg-white text-[#202633]"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    placeholder="Cant."
                    value={it.quantity}
                    onChange={(e) => {
                      const next = [...purchItems];
                      next[idx].quantity = Number(e.target.value);
                      setPurchItems(next);
                    }}
                    className="col-span-2 px-2 py-1.5 font-sans tabular-nums border border-[#202633]/20 rounded text-[#202633]"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Costo u."
                    value={it.unit_cost}
                    onChange={(e) => {
                      const next = [...purchItems];
                      next[idx].unit_cost = Number(e.target.value);
                      setPurchItems(next);
                    }}
                    className="col-span-2 px-2 py-1.5 font-sans tabular-nums border border-[#202633]/20 rounded text-[#202633]"
                  />
                  <input
                    type="date"
                    value={it.batch_expiry}
                    onChange={(e) => {
                      const next = [...purchItems];
                      next[idx].batch_expiry = e.target.value;
                      setPurchItems(next);
                    }}
                    className="col-span-3 px-2 py-1.5 font-mono border border-[#202633]/20 rounded text-[#202633]"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPurchItems([...purchItems, { product_id: products[0]?.id || 1, quantity: 1, unit_cost: 20, batch_expiry: '' }])
                }
                className="text-[#2054C9] font-semibold hover:underline"
              >
                + Agregar línea de producto
              </button>
            </div>

            <label className="inline-flex items-center gap-2 text-[#202633]">
              <input type="checkbox" checked={purchConfirmNow} onChange={(e) => setPurchConfirmNow(e.target.checked)} />
              <span>Confirmar ingreso y actualizar inventario automáticamente</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPurchModal(false)} className="px-4 py-2 bg-[#FFF4E5] text-[#202633] font-medium rounded-lg">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white rounded-lg font-semibold">
                Guardar compra
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Promotion Modal */}
      {promoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202633]/50 p-4">
          <form onSubmit={handleSavePromo} className="bg-white border border-[#202633]/15 rounded-xl w-full max-w-lg p-6 space-y-3 text-xs">
            <h3 className="text-base font-bold text-[#202633] font-sans">Crear promoción o descuento</h3>
            <input
              type="text"
              required
              placeholder="Título de la promoción *"
              value={promoForm.title || ''}
              onChange={(e) => setPromoForm({ ...promoForm, title: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
            <input
              type="text"
              placeholder="Descripción breve"
              value={promoForm.description || ''}
              onChange={(e) => setPromoForm({ ...promoForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-[#202633]/20 rounded-lg text-[#202633]"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={promoForm.scope}
                onChange={(e) => setPromoForm({ ...promoForm, scope: e.target.value as any })}
                className="px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                <option value="category">Por categoría</option>
                <option value="product">Por producto</option>
              </select>
              {promoForm.scope === 'category' ? (
                <select
                  value={promoForm.target_category || ''}
                  onChange={(e) => setPromoForm({ ...promoForm, target_category: e.target.value })}
                  className="px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={promoForm.target_product_id || ''}
                  onChange={(e) => setPromoForm({ ...promoForm, target_product_id: Number(e.target.value) })}
                  className="px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={promoForm.discount_type}
                onChange={(e) => setPromoForm({ ...promoForm, discount_type: e.target.value as any })}
                className="px-3 py-2 border border-[#202633]/20 rounded-lg bg-white text-[#202633]"
              >
                <option value="percentage">Porcentaje (%)</option>
                <option value="special_price">Precio especial (L.)</option>
              </select>
              <input
                type="number"
                min={1}
                step="0.01"
                required
                value={promoForm.discount_value ?? 10}
                onChange={(e) => setPromoForm({ ...promoForm, discount_value: Number(e.target.value) })}
                className="px-3 py-2 font-sans tabular-nums font-semibold border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                required
                value={promoForm.start_date || ''}
                onChange={(e) => setPromoForm({ ...promoForm, start_date: e.target.value })}
                className="px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
              <input
                type="date"
                required
                value={promoForm.end_date || ''}
                onChange={(e) => setPromoForm({ ...promoForm, end_date: e.target.value })}
                className="px-3 py-2 font-mono border border-[#202633]/20 rounded-lg text-[#202633]"
              />
            </div>
            <label className="inline-flex items-center gap-2 pt-1 text-[#202633]">
              <input
                type="checkbox"
                checked={Boolean(promoForm.publish_in_app)}
                onChange={(e) => setPromoForm({ ...promoForm, publish_in_app: e.target.checked ? 1 : 0 })}
              />
              <span>Publicar promoción en la aplicación de clientes</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPromoModal(false)} className="px-4 py-2 bg-[#FFF4E5] text-[#202633] font-medium rounded-lg">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-2 bg-[#2054C9] hover:bg-[#1943A3] text-white rounded-lg font-semibold">
                Crear promoción
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
