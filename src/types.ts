export const PRODUCT_CATEGORIES = [
  'Bebidas',
  'Snacks y golosinas',
  'Abarrotes',
  'Lácteos',
  'Productos congelados',
  'Limpieza',
  'Higiene personal',
  'Productos para el hogar',
  'Otros productos',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type UserRole =
  | 'Administrador'
  | 'Cajero'
  | 'Encargado de pedidos'
  | 'Encargado de inventario'
  | 'Repartidor'
  | 'Cliente';

export type OrderStatus =
  | 'recibido'
  | 'confirmado'
  | 'en_preparacion'
  | 'listo_recoger'
  | 'en_camino'
  | 'entregado'
  | 'rechazado'
  | 'cancelado';

export type OrderChannel = 'online' | 'pos';
export type DeliveryMode = 'domicilio' | 'recoger';
export type PaymentMethod = 'efectivo' | 'transferencia';

export interface UserAccount {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  is_active: number;
  created_at: string;
}

export interface DeliveryZone {
  id: string;
  name: string;
  fee: number;
  eta: string;
  active: boolean;
}

export interface BankAccount {
  id: string;
  bank: string;
  account_number: string;
  account_type: string;
  holder: string;
}

export interface FiscalConfig {
  rtn: string;
  razon_social: string;
  cai: string;
  punto_emision: string;
  rango_inicial: number;
  rango_final: number;
  correlativo_actual: number;
  fecha_limite_emision: string;
  isv_rate: number;
  modalidad: string;
  mensaje_pie: string;
}

export interface PrinterConfig {
  thermal_width: '80mm' | '58mm';
  auto_print_pos: boolean;
  open_cash_drawer: boolean;
  conventional_format: 'Carta' | 'Media Carta';
  printer_name: string;
}

export interface NotificationsConfig {
  sound_new_order: boolean;
  low_stock_alert: boolean;
  expiry_alert_days: number;
}

export interface ScannerConfig {
  hid_enabled: boolean;
  suffix_key: 'Enter' | 'Tab';
  auto_focus_pos: boolean;
  beep_on_scan: boolean;
  camera_enabled: boolean;
  preferred_camera_facing: 'environment' | 'user';
  auto_increment_qty: boolean;
}

export interface BusinessSettings {
  business_name: string;
  logo_url: string;
  address: string;
  phones: string;
  hours: string;
  min_order_amount: number;
  store_lat: number;
  store_lng: number;
  delivery_zones: DeliveryZone[];
  bank_accounts: BankAccount[];
  fiscal_config: FiscalConfig;
  printer_config: PrinterConfig;
  notifications_config: NotificationsConfig;
  scanner_config: ScannerConfig;
}

export interface Product {
  id: number;
  internal_code: string;
  barcode: string;
  name: string;
  description: string;
  brand: string;
  presentation: string;
  category: ProductCategory;
  purchase_price?: number;
  sale_price: number;
  tax_rate: number;
  stock: number;
  min_stock: number;
  expiry_date: string | null;
  image_url: string;
  is_featured: number;
  is_bestseller: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  barcodes?: ProductBarcode[];
  // Computed promotion fields when fetched
  promo_price?: number | null;
  promo_title?: string | null;
  promo_discount_pct?: number | null;
}

export interface ProductBarcode {
  id: number;
  product_id: number;
  code: string;
  code_type: 'comercial' | 'interno';
  presentation_label: string;
  price_override: number | null;
  created_at: string;
}

export interface PriceHistory {
  id: number;
  product_id: number;
  product_name?: string;
  old_purchase_price: number;
  new_purchase_price: number;
  old_sale_price: number;
  new_sale_price: number;
  changed_by: string;
  changed_at: string;
}

export interface Promotion {
  id: number;
  title: string;
  description: string;
  scope: 'product' | 'category';
  target_product_id: number | null;
  target_product_name?: string | null;
  target_category: string | null;
  discount_type: 'percentage' | 'special_price';
  discount_value: number;
  start_date: string;
  end_date: string;
  publish_in_app: number;
  is_active: number;
  banner_image_url: string;
  created_at: string;
}

export interface CustomerAddress {
  id: string;
  label: string;
  address: string;
  reference: string;
  zone_id: string;
  lat?: number | null;
  lng?: number | null;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  rtn: string;
  razon_social: string;
  addresses: CustomerAddress[];
  notes: string;
  user_id: number | null;
  created_at: string;
  orders_count?: number;
  total_spent?: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  internal_code: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
  line_total: number;
}

export interface Order {
  id: number;
  order_number: string;
  channel: OrderChannel;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  customer_rtn: string;
  delivery_mode: DeliveryMode;
  delivery_address: string;
  delivery_reference: string;
  delivery_notes: string;
  delivery_zone_name: string;
  delivery_fee: number;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  estimated_distance_km?: number | null;
  estimated_duration_min?: number | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  customer_confirmed_at?: string | null;
  driver_started_at?: string | null;
  payment_method: PaymentMethod;
  transfer_proof_url: string;
  cash_received: number;
  change_given: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  status: OrderStatus;
  rejection_reason: string;
  assigned_driver_id: number | null;
  assigned_driver_name: string;
  created_by_user_id: number | null;
  created_by_name: string;
  tracking_token?: string;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  invoice_id?: number | null;
  invoice_number?: string | null;
  invoice_status?: 'emitida' | 'anulada' | null;
}

export interface DriverLocation {
  driver_id: number;
  driver_name?: string;
  driver_phone?: string;
  order_id: number | null;
  order_number?: string | null;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
  accuracy_m: number;
  is_tracking: number;
  updated_at: string;
  remaining_km?: number;
  eta_min?: number;
}

export interface DeliveryNotification {
  id: number;
  order_id: number;
  order_number?: string;
  target_role: 'customer' | 'driver' | 'admin';
  target_user_id: number | null;
  event_type: 'driver_assigned' | 'order_dispatched' | 'driver_near' | 'order_delivered';
  title: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface RouteStep {
  instruction: string;
  road_name: string;
  distance_m: number;
  duration_s: number;
}

export interface ComputedRoute {
  geometry: [number, number][];
  distance_km: number;
  duration_min: number;
  steps: RouteStep[];
  fallback?: boolean;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  order_id: number;
  order_number?: string;
  channel?: OrderChannel;
  cai: string;
  rango_autorizado: string;
  fecha_limite_emision: string;
  emitter_name: string;
  emitter_rtn: string;
  emitter_address: string;
  customer_name: string;
  customer_rtn: string;
  subtotal_exento: number;
  subtotal_gravado_15: number;
  isv_15: number;
  discount_total: number;
  delivery_fee: number;
  total: number;
  amount_in_words: string;
  payment_method: PaymentMethod;
  status: 'emitida' | 'anulada';
  credit_note_number: string;
  void_reason: string;
  voided_by: string;
  voided_at: string | null;
  issued_by: string;
  issued_at: string;
  items?: OrderItem[];
}

export interface CashSession {
  id: number;
  opened_by_id: number;
  opened_by_name: string;
  opening_amount: number;
  opened_at: string;
  closed_by_id: number | null;
  closed_by_name: string | null;
  closed_at: string | null;
  cash_sales_total: number;
  transfer_sales_total: number;
  entries_total: number;
  withdrawals_total: number;
  expenses_total: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  notes: string;
  status: 'abierta' | 'cerrada';
}

export interface CashMovement {
  id: number;
  session_id: number;
  type: 'entrada' | 'salida' | 'gasto';
  amount: number;
  concept: string;
  user_name: string;
  created_at: string;
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  product_name?: string;
  internal_code?: string;
  type:
    | 'entrada'
    | 'salida'
    | 'ajuste'
    | 'venta_pos'
    | 'pedido_online'
    | 'compra'
    | 'perdida_danado'
    | 'conteo_fisico'
    | 'devolucion';
  quantity_delta: number;
  previous_stock: number;
  new_stock: number;
  reason: string;
  batch_expiry: string | null;
  user_name: string;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  rtn: string;
  contact_name: string;
  phone: string;
  email: string;
  products_supplied: string;
  notes: string;
  created_at: string;
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  batch_expiry: string | null;
}

export interface Purchase {
  id: number;
  supplier_id: number;
  supplier_name?: string;
  document_number: string;
  purchase_date: string;
  total_cost: number;
  status: 'pendiente' | 'confirmada';
  notes: string;
  created_by: string;
  confirmed_at: string | null;
  created_at: string;
  items?: PurchaseItem[];
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string;
  user_role: string;
  module: string;
  action: string;
  details: string;
  created_at: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}
