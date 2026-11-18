import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { Invoice, OrderStatus } from '../types';

const TOKEN_KEY = 'lpm_auth_token';
const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '') || '';

export function getApiBaseUrl(): string {
  return RAW_API_BASE;
}

export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!RAW_API_BASE) return url;
  return `${RAW_API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(resolveApiUrl(url), { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data as T;
}

export function formatCurrency(val: number | undefined | null): string {
  const num = Number(val || 0);
  return `L. ${num.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  recibido: 'Pedido recibido',
  confirmado: 'Pedido confirmado',
  en_preparacion: 'En preparación',
  listo_recoger: 'Listo para recoger',
  en_camino: 'En camino',
  entregado: 'Entregado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
};

export function getStatusColorClass(status: OrderStatus): string {
  switch (status) {
    case 'entregado':
      return 'text-[#0A7830]';
    case 'en_camino':
    case 'listo_recoger':
    case 'confirmado':
      return 'text-[#2054C9]';
    case 'en_preparacion':
    case 'recibido':
      return 'text-[#8A6D00]';
    case 'rechazado':
    case 'cancelado':
      return 'text-red-700';
    default:
      return 'text-[#202633]';
  }
}

export function downloadInvoicePDF(invoice: Invoice): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('LOS PATRONES MINI MARKET', 15, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Comercio: ${invoice.emitter_name || 'Los Patrones Mini Market'}`, 15, 25);
  doc.text(`Dirección: ${invoice.emitter_address}`, 15, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`COMPROBANTE N.º ${invoice.invoice_number}`, 132, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Fecha Emisión: ${invoice.issued_at}`, 132, 24);
  doc.text(`Estado: ${invoice.status === 'anulada' ? 'ANULADO' : 'EMITIDO'}`, 132, 29);
  if (invoice.status === 'anulada' && invoice.credit_note_number) {
    doc.text(`Nota de Anulación: ${invoice.credit_note_number}`, 132, 34);
  }

  doc.line(15, 39, 200, 39);

  doc.setFont('helvetica', 'bold');
  doc.text('Datos del Cliente', 15, 46);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cliente: ${invoice.customer_name}`, 15, 51);
  doc.text(`Método de Pago: ${invoice.payment_method === 'transferencia' ? 'Transferencia Bancaria' : 'Efectivo'}`, 132, 46);
  doc.text(`Pedido Ref.: ${invoice.order_number || `#${invoice.order_id}`}`, 132, 51);

  const tableRows = (invoice.items || []).map((it) => [
    it.internal_code,
    it.product_name,
    String(it.quantity),
    formatCurrency(it.unit_price),
    formatCurrency(it.line_total),
  ]);

  autoTable(doc, {
    startY: 58,
    head: [['Código', 'Descripción', 'Cant.', 'Precio Unit.', 'Total']],
    body: tableRows,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [32, 84, 201] },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : 120;

  doc.setFontSize(9);
  doc.text(`Descuentos y Rebajas: ${formatCurrency(invoice.discount_total)}`, 135, finalY);
  if (invoice.delivery_fee > 0) {
    doc.text(`Costo de Envío: ${formatCurrency(invoice.delivery_fee)}`, 135, finalY + 5);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`TOTAL A PAGAR: ${formatCurrency(invoice.total)}`, 135, finalY + 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Son: ${invoice.amount_in_words}`, 15, finalY + 22);
  doc.setFontSize(7.5);
  doc.text('Gracias por su compra en Los Patrones Mini Market.', 15, finalY + 30);

  doc.save(`Comprobante_${invoice.invoice_number}.pdf`);
}

export function exportRowsToExcel(filename: string, sheetName: string, rows: Record<string, any>[]): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportReportPDF(title: string, columns: string[], rows: (string | number)[][], filename: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`LOS PATRONES MINI MARKET — ${title}`, 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleString('es-HN')}`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [columns],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [32, 38, 51] },
  });

  doc.save(`${filename}.pdf`);
}
