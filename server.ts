import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { db, initDatabase, logAudit, numberToLempirasWords } from './server/db.ts';

initDatabase();

interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  is_active: number;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
}

const ALLOWED_ROLES = ['Administrador', 'Cajero', 'Encargado de pedidos', 'Encargado de inventario', 'Repartidor', 'Cliente'] as const;
const COST_ROLES = new Set(['Administrador', 'Encargado de inventario']);
const ALLOWED_ORDER_STATUSES = new Set([
  'recibido',
  'confirmado',
  'en_preparacion',
  'listo_recoger',
  'en_camino',
  'entregado',
  'rechazado',
  'cancelado',
]);

function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  return trimmed.length >= 5 && trimmed.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

function cleanText(val: unknown, maxLen = 500): string {
  if (val === undefined || val === null) return '';
  return String(val).trim().slice(0, maxLen);
}

function parsePositiveInt(val: unknown): number | null {
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseNonNegativeNumber(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isValidCoord(lat: unknown, lng: unknown): boolean {
  if (lat === '' || lng === '' || lat === null || lng === null || lat === undefined || lng === undefined) return false;
  const la = Number(lat);
  const lo = Number(lng);
  return Number.isFinite(la) && Number.isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

function isValidTransferProof(val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length > 5_000_000) return false;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) return true;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return true;
  return false;
}

function safeTimingEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sanitizeProductForUser(prod: any, user?: AuthUser) {
  if (!prod) return prod;
  if (user && COST_ROLES.has(user.role)) return prod;
  const { purchase_price: _omitted, ...safeProd } = prod;
  return safeProd;
}

function sanitizeOrderForResponse(order: any) {
  if (!order) return order;
  const { tracking_token: _omittedToken, ...safeOrder } = order;
  return safeOrder;
}

function getClientIp(req: Request): string {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  };
  setInterval(cleanup, Math.min(windowMs, 5 * 60 * 1000)).unref();

  return (key: string): { allowed: boolean; retryAfterSec: number } => {
    const now = Date.now();
    const current = hits.get(key);
    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (current.count >= maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  };
}

function getUserFromRequest(req: Request): AuthUser | undefined {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return undefined;
  const token = auth.slice(7).trim();
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.is_active = 1 AND s.expires_at > datetime('now', 'localtime')`
    )
    .get(token) as AuthUser | undefined;
  return row;
}

function requireAuth(roles?: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: 'Sesión no válida o expirada. Inicie sesión.' });
      return;
    }
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      res.status(403).json({ error: `Acceso denegado para el rol ${user.role}.` });
      return;
    }
    req.user = user;
    next();
  };
}

function getParsedSettings() {
  const row = db.prepare('SELECT * FROM business_settings WHERE id = 1').get() as Record<string, any>;
  return {
    business_name: row.business_name,
    logo_url: row.logo_url,
    address: row.address,
    phones: row.phones,
    hours: row.hours,
    min_order_amount: row.min_order_amount,
    store_lat: Number(row.store_lat ?? 15.612194),
    store_lng: Number(row.store_lng ?? -87.939167),
    delivery_zones: JSON.parse(row.delivery_zones || '[]'),
    bank_accounts: JSON.parse(row.bank_accounts || '[]'),
    fiscal_config: JSON.parse(row.fiscal_config || '{}'),
    printer_config: JSON.parse(row.printer_config || '{}'),
    notifications_config: JSON.parse(row.notifications_config || '{}'),
    scanner_config: JSON.parse(row.scanner_config || '{}'),
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getZoneDefaultCoords(zoneId: string): { lat: number; lng: number } {
  switch (zoneId) {
    case 'jardines':
      return { lat: 15.6145, lng: -87.951 };
    case 'alamos':
      return { lat: 15.588, lng: -87.962 };
    case 'universidad':
      return { lat: 15.625, lng: -87.935 };
    case 'centro':
    default:
      return { lat: 15.6105, lng: -87.9415 };
  }
}

function translateOsrmStep(step: any): string {
  const mType = step?.maneuver?.type || 'continue';
  const mod = step?.maneuver?.modifier || '';
  const road = step?.name ? ` hacia ${step.name}` : '';
  const modEs: Record<string, string> = {
    left: 'a la izquierda',
    right: 'a la derecha',
    'slight left': 'ligeramente a la izquierda',
    'slight right': 'ligeramente a la derecha',
    'sharp left': 'fuerte a la izquierda',
    'sharp right': 'fuerte a la derecha',
    straight: 'recto',
    uturn: 'en U',
  };
  const dir = modEs[mod] || '';
  if (mType === 'depart') return `Inicia el recorrido${road}`;
  if (mType === 'arrive') return 'Llegarás al punto de entrega del cliente';
  if (mType === 'turn' || mType === 'new name' || mType === 'end of road') {
    return `Gira ${dir || 'al frente'}${road}`.trim();
  }
  if (mType === 'roundabout' || mType === 'rotary') {
    return `Toma la rotonda${road}`;
  }
  return `Continúa ${dir}${road}`.replace(/\s+/g, ' ').trim();
}

function getActivePromotions() {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT p.*, pr.name as target_product_name
       FROM promotions p
       LEFT JOIN products pr ON pr.id = p.target_product_id
       WHERE p.is_active = 1 AND p.start_date <= ? AND p.end_date >= ?
       ORDER BY p.id DESC`
    )
    .all(today, today) as any[];
}

function enrichProductsWithPromos(products: any[]) {
  const promos = getActivePromotions();
  const allBarcodes = db.prepare('SELECT * FROM product_barcodes ORDER BY id ASC').all() as any[];
  const bcMap = new Map<number, any[]>();
  for (const b of allBarcodes) {
    const arr = bcMap.get(b.product_id) || [];
    arr.push(b);
    bcMap.set(b.product_id, arr);
  }

  return products.map((prod) => {
    let bestPrice: number | null = null;
    let promoTitle: string | null = null;
    let promoDiscountPct: number | null = null;

    for (const promo of promos) {
      const matchesProduct = promo.scope === 'product' && promo.target_product_id === prod.id;
      const matchesCategory = promo.scope === 'category' && promo.target_category === prod.category;
      if (!matchesProduct && !matchesCategory) continue;

      let candidate = prod.sale_price;
      if (promo.discount_type === 'percentage') {
        candidate = Number((prod.sale_price * (1 - promo.discount_value / 100)).toFixed(2));
      } else if (promo.discount_type === 'special_price') {
        candidate = Number(promo.discount_value);
      }
      if (candidate < prod.sale_price && (bestPrice === null || candidate < bestPrice)) {
        bestPrice = candidate;
        promoTitle = promo.title;
        promoDiscountPct = Math.round(((prod.sale_price - candidate) / prod.sale_price) * 100);
      }
    }

    return {
      ...prod,
      barcodes: bcMap.get(prod.id) || [],
      promo_price: bestPrice,
      promo_title: promoTitle,
      promo_discount_pct: promoDiscountPct,
    };
  });
}

function generateInvoiceForOrder(orderId: number, issuedBy: string) {
  const existing = db.prepare('SELECT * FROM invoices WHERE order_id = ? AND status = ?').get(orderId, 'emitida') as any;
  if (existing) return existing;

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) throw new Error('Pedido no encontrado');

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId) as any[];
  const settings = getParsedSettings();
  const fiscal = settings.fiscal_config;

  const nextCorr = Number(fiscal.correlativo_actual || 142) + 1;
  const corrPadded = String(nextCorr).padStart(8, '0');
  const invoiceNumber = `CMP-${corrPadded}`;

  const words = numberToLempirasWords(order.total);

  const res = db
    .prepare(
      `INSERT INTO invoices (
        invoice_number, order_id, cai, rango_autorizado, fecha_limite_emision,
        emitter_name, emitter_rtn, emitter_address, customer_name, customer_rtn,
        subtotal_exento, subtotal_gravado_15, isv_15, discount_total, delivery_fee,
        total, amount_in_words, payment_method, status, issued_by
      ) VALUES (?, ?, '', '', '', ?, '', ?, ?, '', 0, 0, 0, ?, ?, ?, ?, ?, 'emitida', ?)`
    )
    .run(
      invoiceNumber,
      orderId,
      settings.business_name,
      settings.address,
      order.customer_name || 'Cliente General',
      order.discount_total,
      order.delivery_fee,
      order.total,
      words,
      order.payment_method,
      issuedBy
    );

  fiscal.correlativo_actual = nextCorr;
  db.prepare('UPDATE business_settings SET fiscal_config = ? WHERE id = 1').run(JSON.stringify(fiscal));

  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(res.lastInsertRowid));
}

function hydrateOrder(order: any) {
  if (!order) return null;
  const safeOrder = sanitizeOrderForResponse(order);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const inv = db.prepare('SELECT id, invoice_number, status FROM invoices WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order.id) as any;
  return {
    ...safeOrder,
    items,
    invoice_id: inv?.id ?? null,
    invoice_number: inv?.invoice_number ?? null,
    invoice_status: inv?.status ?? null,
  };
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const allowedOrigins = new Set(
    String(process.env.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tracking-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    if (
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/orders') ||
      req.path.startsWith('/api/customers') ||
      req.path.startsWith('/api/invoices') ||
      req.path.startsWith('/api/users') ||
      req.path.startsWith('/api/backup')
    ) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(express.json({ limit: '5mb' }));

  const checkLoginRate = createRateLimiter(8, 15 * 60 * 1000);
  const checkMapsRate = createRateLimiter(30, 60 * 1000);
  const checkAssistantRate = createRateLimiter(20, 60 * 1000);

  const cleanupExpiredSessions = () => {
    db.prepare("DELETE FROM sessions WHERE expires_at IS NULL OR expires_at <= datetime('now', 'localtime')").run();
  };
  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, 15 * 60 * 1000).unref();

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  const wsRooms = new Map<string, Set<WebSocket>>();

  const joinRoom = (ws: WebSocket, room: string) => {
    let set = wsRooms.get(room);
    if (!set) {
      set = new Set();
      wsRooms.set(room, set);
    }
    set.add(ws);
    const meta = (ws as any).__rooms as Set<string> | undefined;
    if (meta) meta.add(room);
  };

  const leaveAllRooms = (ws: WebSocket) => {
    const meta = (ws as any).__rooms as Set<string> | undefined;
    if (!meta) return;
    for (const r of meta) {
      const set = wsRooms.get(r);
      if (set) {
        set.delete(ws);
        if (set.size === 0) wsRooms.delete(r);
      }
    }
    meta.clear();
  };

  const broadcastRoom = (room: string, payload: Record<string, unknown>) => {
    const set = wsRooms.get(room);
    if (!set || set.size === 0) return;
    const raw = JSON.stringify(payload);
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  };

  const getUserByToken = (token?: string): AuthUser | undefined => {
    if (!token || typeof token !== 'string') return undefined;
    return db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND u.is_active = 1 AND s.expires_at > datetime('now', 'localtime')`
      )
      .get(token.trim()) as AuthUser | undefined;
  };

  wss.on('connection', (ws) => {
    (ws as any).__rooms = new Set<string>();
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'subscribe' && typeof msg.room === 'string') {
          const user = getUserByToken(msg.token);
          if (!user) {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Se requiere una sesión válida y vigente.' }));
            ws.close(4001, 'Unauthorized');
            return;
          }
          const room = msg.room.trim();
          if (room.startsWith('order:')) {
            const orderKey = room.slice('order:'.length).trim();
            if (!orderKey) {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'Identificador de pedido inválido.' }));
              return;
            }
            const numericId = parsePositiveInt(orderKey);
            const order = (
              numericId
                ? db.prepare('SELECT id, order_number, created_by_user_id, assigned_driver_id FROM orders WHERE UPPER(order_number) = UPPER(?) OR id = ?').get(orderKey, numericId)
                : db.prepare('SELECT id, order_number, created_by_user_id, assigned_driver_id FROM orders WHERE UPPER(order_number) = UPPER(?)').get(orderKey)
            ) as { id: number; order_number: string; created_by_user_id: number | null; assigned_driver_id: number | null } | undefined;

            if (!order) {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'Pedido no encontrado.' }));
              return;
            }
            const isStaffAllowed = ['Administrador', 'Encargado de pedidos', 'Cajero'].includes(user.role);
            const isCreator = order.created_by_user_id !== null && order.created_by_user_id === user.id;
            const isAssignedDriver = user.role === 'Repartidor' && order.assigned_driver_id === user.id;
            if (!isStaffAllowed && !isCreator && !isAssignedDriver) {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'No autorizado para suscribirse a este pedido.' }));
              ws.close(4003, 'Forbidden');
              return;
            }
            joinRoom(ws, `order:${order.order_number}`);
          } else if (room === 'admin') {
            if (['Administrador', 'Encargado de pedidos'].includes(user.role)) {
              joinRoom(ws, 'admin');
            } else {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'No autorizado para sala administrativa.' }));
              ws.close(4003, 'Forbidden');
            }
          } else if (room === 'driver') {
            if (['Repartidor', 'Administrador'].includes(user.role)) {
              joinRoom(ws, `driver:${user.id}`);
            } else {
              ws.send(JSON.stringify({ type: 'auth_error', error: 'No autorizado para sala de repartidores.' }));
              ws.close(4003, 'Forbidden');
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('close', () => leaveAllRooms(ws));
  });

  // --- AUTH ---
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const rate = checkLoginRate(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        error: 'Demasiados intentos de inicio de sesión. Por seguridad, espere 15 minutos antes de intentar nuevamente.',
      });
      return;
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      res.status(400).json({ error: 'Ingrese correo y contraseña.' });
      return;
    }
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(cleanText(email, 160)) as any;
    if (!user || !user.is_active || !bcrypt.compareSync(String(password), user.password_hash)) {
      res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });
      return;
    }
    cleanupExpiredSessions();
    const token = crypto.randomBytes(24).toString('hex');
    const ttlModifier = user.role === 'Cliente' ? '+24 hours' : '+12 hours';
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', 'localtime', ?))").run(
      token,
      user.id,
      ttlModifier
    );
    logAudit(user, 'Autenticación', 'Inicio de sesión', `Usuario ${user.email} (${user.role}) inició sesión.`);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        is_active: user.is_active,
      },
    });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { name, email, phone, password, rtn } = req.body || {};
    const cleanName = cleanText(name, 120);
    const cleanEmail = cleanText(email, 160).toLowerCase();
    const cleanPhone = cleanText(phone, 40);
    const cleanRtn = cleanText(rtn, 30);
    const rawPassword = typeof password === 'string' ? password : '';

    if (cleanName.length < 2 || !cleanEmail || !rawPassword) {
      res.status(400).json({ error: 'Nombre, correo y contraseña requeridos.' });
      return;
    }
    if (!isValidEmail(cleanEmail)) {
      res.status(400).json({ error: 'Ingrese un correo electrónico válido.' });
      return;
    }
    if (rawPassword.length < 8 || rawPassword.length > 128) {
      res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
    if (exists) {
      res.status(400).json({ error: 'Este correo ya está registrado.' });
      return;
    }
    const hash = bcrypt.hashSync(rawPassword, 10);
    const uRes = db
      .prepare('INSERT INTO users (name, email, phone, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(cleanName, cleanEmail, cleanPhone, hash, 'Cliente');
    const userId = Number(uRes.lastInsertRowid);

    db.prepare(
      'INSERT INTO customers (name, phone, email, rtn, razon_social, addresses, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(cleanName, cleanPhone, cleanEmail, cleanRtn, cleanName, '[]', 'Registrado desde tienda en línea', userId);

    const token = crypto.randomBytes(24).toString('hex');
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', 'localtime', '+24 hours'))").run(token, userId);

    res.json({
      token,
      user: { id: userId, name: cleanName, email: cleanEmail, phone: cleanPhone, role: 'Cliente', is_active: 1 },
    });
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const user = getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    res.json({ user });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.slice(7).trim());
    }
    res.json({ ok: true });
  });

  // --- STOREFRONT & PUBLIC ---
  app.get('/api/storefront/init', (req: Request, res: Response) => {
    const authedUser = getUserFromRequest(req);
    const settings = getParsedSettings();
    const rawProducts = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY is_featured DESC, is_bestseller DESC, name ASC').all();
    const products = enrichProductsWithPromos(rawProducts).map((p) => sanitizeProductForUser(p, authedUser));
    const promotions = getActivePromotions().filter((p) => p.publish_in_app === 1);
    res.json({ settings, products, promotions });
  });

  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json(getParsedSettings());
  });

  app.put('/api/settings', requireAuth(['Administrador']), (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const minOrder = parseNonNegativeNumber(body.min_order_amount ?? 70);
    const storeLat = Number(body.store_lat ?? 15.612194);
    const storeLng = Number(body.store_lng ?? -87.939167);
    if (minOrder === null) {
      res.status(400).json({ error: 'El pedido mínimo no puede ser negativo.' });
      return;
    }
    if (!isValidCoord(storeLat, storeLng)) {
      res.status(400).json({ error: 'Coordenadas de la tienda inválidas.' });
      return;
    }
    const zones = Array.isArray(body.delivery_zones)
      ? body.delivery_zones.map((z: any) => ({
          id: cleanText(z.id, 40) || 'zona',
          name: cleanText(z.name, 120),
          fee: Math.max(0, Number(z.fee || 0) || 0),
          eta: cleanText(z.eta, 60),
          active: Boolean(z.active),
        }))
      : [];

    db.prepare(
      `UPDATE business_settings SET
        business_name = ?, logo_url = ?, address = ?, phones = ?, hours = ?, min_order_amount = ?,
        store_lat = ?, store_lng = ?,
        delivery_zones = ?, bank_accounts = ?, fiscal_config = ?, printer_config = ?, notifications_config = ?, scanner_config = ?
       WHERE id = 1`
    ).run(
      cleanText(body.business_name, 140),
      cleanText(body.logo_url, 500),
      cleanText(body.address, 250),
      cleanText(body.phones, 80),
      cleanText(body.hours, 120),
      minOrder,
      storeLat,
      storeLng,
      JSON.stringify(zones),
      JSON.stringify(Array.isArray(body.bank_accounts) ? body.bank_accounts : []),
      JSON.stringify(body.fiscal_config || {}),
      JSON.stringify(body.printer_config || {}),
      JSON.stringify(body.notifications_config || {}),
      JSON.stringify(body.scanner_config || {})
    );
    logAudit(req.user!, 'Configuración', 'Actualización general', 'Parámetros del negocio, coordenadas, escáner, zonas y bancos actualizados.');
    res.json(getParsedSettings());
  });

  // --- MAPS, GEOCODING & ROUTING (SERVER-SIDE PROXY) ---
  app.get('/api/maps/geocode', requireAuth(), async (req: AuthedRequest, res: Response) => {
    const rate = checkMapsRate(`maps:${req.user!.id}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Límite de consultas al mapa alcanzado. Espere un minuto.' });
      return;
    }
    const query = cleanText(req.query.q, 200);
    const zoneId = cleanText(req.query.zone_id, 40) || 'centro';
    if (!query) {
      const def = getZoneDefaultCoords(zoneId);
      res.json({ lat: def.lat, lng: def.lng, display_name: 'Zona de entrega seleccionada, Choloma, Cortés', approximate: true });
      return;
    }
    try {
      const searchQ = query.toLowerCase().includes('honduras') ? query : `${query}, Choloma, Cortés, Honduras`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=hn&viewbox=-88.02,15.68,-87.86,15.55&q=${encodeURIComponent(searchQ)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(url, {
        headers: { 'User-Agent': 'LosPatronesMiniMarket/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (r.ok) {
        const list = (await r.json()) as any[];
        if (Array.isArray(list) && list.length > 0) {
          res.json({
            lat: Number(list[0].lat),
            lng: Number(list[0].lon),
            display_name: list[0].display_name,
            approximate: false,
          });
          return;
        }
      }
    } catch {
      // Fallback gracefully below
    }
    const def = getZoneDefaultCoords(zoneId);
    res.json({
      lat: def.lat,
      lng: def.lng,
      display_name: `${query} (punto aproximado en zona; ajusta el pin en el mapa si deseas)`,
      approximate: true,
    });
  });

  app.get('/api/maps/reverse', requireAuth(), async (req: AuthedRequest, res: Response) => {
    const rate = checkMapsRate(`maps:${req.user!.id}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Límite de consultas al mapa alcanzado. Espere un minuto.' });
      return;
    }
    if (!isValidCoord(req.query.lat, req.query.lng)) {
      res.status(400).json({ error: 'Coordenadas inválidas.' });
      return;
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(url, {
        headers: { 'User-Agent': 'LosPatronesMiniMarket/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (r.ok) {
        const data = (await r.json()) as any;
        res.json({ address: data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
        return;
      }
    } catch {
      // fallback
    }
    res.json({ address: `Ubicación seleccionada (${lat.toFixed(5)}, ${lng.toFixed(5)})` });
  });

  app.get('/api/maps/route', requireAuth(), async (req: AuthedRequest, res: Response) => {
    const rate = checkMapsRate(`maps:${req.user!.id}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Límite de consultas al mapa alcanzado. Espere un minuto.' });
      return;
    }
    if (!isValidCoord(req.query.originLat, req.query.originLng) || !isValidCoord(req.query.destLat, req.query.destLng)) {
      res.status(400).json({ error: 'Coordenadas de origen y destino requeridas.' });
      return;
    }
    const oLat = Number(req.query.originLat);
    const oLng = Number(req.query.originLng);
    const dLat = Number(req.query.destLat);
    const dLng = Number(req.query.destLng);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (r.ok) {
        const data = (await r.json()) as any;
        const route = data?.routes?.[0];
        if (route?.geometry?.coordinates) {
          const geometry: [number, number][] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
          const steps = (route.legs?.[0]?.steps || []).map((st: any) => ({
            instruction: translateOsrmStep(st),
            road_name: st.name || '',
            distance_m: Math.round(st.distance || 0),
            duration_s: Math.round(st.duration || 0),
          }));
          res.json({
            geometry,
            distance_km: Number(((route.distance || 0) / 1000).toFixed(2)),
            duration_min: Math.max(1, Math.round((route.duration || 0) / 60)),
            steps,
            fallback: false,
          });
          return;
        }
      }
    } catch {
      // fallback to Haversine direct line
    }
    const distKm = Number((haversineKm(oLat, oLng, dLat, dLng) * 1.25).toFixed(2));
    const etaMin = Math.max(3, Math.round((distKm / 26) * 60));
    res.json({
      geometry: [
        [oLat, oLng],
        [dLat, dLng],
      ],
      distance_km: distKm,
      duration_min: etaMin,
      steps: [
        { instruction: 'Sal del establecimiento hacia la vía principal en dirección al destino', road_name: 'Ruta directa estimada', distance_m: Math.round(distKm * 1000), duration_s: etaMin * 60 },
        { instruction: 'Llegarás al punto de entrega del cliente', road_name: '', distance_m: 0, duration_s: 0 },
      ],
      fallback: true,
    });
  });

  // --- PRODUCTS ---
  app.get('/api/products', (req: Request, res: Response) => {
    const authedUser = getUserFromRequest(req);
    const canManageCosts = Boolean(authedUser && COST_ROLES.has(authedUser.role));
    const includeInactive = req.query.all === '1';
    if (includeInactive && !canManageCosts) {
      res.status(403).json({ error: 'Solo administradores o encargados de inventario pueden consultar productos inactivos.' });
      return;
    }
    const rows = db
      .prepare(includeInactive ? 'SELECT * FROM products ORDER BY id DESC' : 'SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC')
      .all();
    res.json(enrichProductsWithPromos(rows).map((p) => sanitizeProductForUser(p, authedUser)));
  });

  app.post('/api/products', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const p = req.body || {};
    const cleanInternal = cleanText(p.internal_code, 60);
    const cleanBarcode = cleanText(p.barcode, 80);
    const cleanName = cleanText(p.name, 160);
    const cleanCategory = cleanText(p.category, 80);
    const purchasePrice = parseNonNegativeNumber(p.purchase_price ?? 0);
    const salePrice = parseNonNegativeNumber(p.sale_price ?? 0);
    const stock = parseNonNegativeNumber(p.stock ?? 0);
    const minStock = parseNonNegativeNumber(p.min_stock ?? 5);

    try {
      if (!cleanInternal || !cleanName || !cleanCategory) {
        res.status(400).json({ error: 'Código interno, nombre y categoría son obligatorios.' });
        return;
      }
      if (purchasePrice === null || salePrice === null || salePrice <= 0) {
        res.status(400).json({ error: 'Los precios deben ser valores numéricos válidos y el precio de venta mayor a 0.' });
        return;
      }
      if (stock === null || !Number.isInteger(stock) || minStock === null || !Number.isInteger(minStock)) {
        res.status(400).json({ error: 'El stock y stock mínimo deben ser enteros mayores o iguales a 0.' });
        return;
      }
      if (cleanBarcode) {
        const dup = db.prepare('SELECT p.name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE LOWER(b.code) = LOWER(?)').get(cleanBarcode) as any;
        if (dup) {
          res.status(400).json({ error: `Código de barras "${cleanBarcode}" ya está asignado a "${dup.name}".` });
          return;
        }
      }
      const dupInternal = db.prepare('SELECT p.name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE LOWER(b.code) = LOWER(?)').get(cleanInternal) as any;
      if (dupInternal) {
        res.status(400).json({ error: `Código interno "${cleanInternal}" ya está en uso por "${dupInternal.name}".` });
        return;
      }

      const id = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO products (
              internal_code, barcode, name, description, brand, presentation, category,
              purchase_price, sale_price, tax_rate, stock, min_stock, expiry_date, image_url,
              is_featured, is_bestseller, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            cleanInternal,
            cleanBarcode,
            cleanName,
            cleanText(p.description, 500),
            cleanText(p.brand, 100),
            cleanText(p.presentation, 100),
            cleanCategory,
            purchasePrice,
            salePrice,
            stock,
            minStock,
            p.expiry_date ? cleanText(p.expiry_date, 20) : null,
            cleanText(p.image_url, 1000),
            p.is_featured ? 1 : 0,
            p.is_bestseller ? 1 : 0,
            p.is_active === 0 ? 0 : 1
          );
        const newId = Number(result.lastInsertRowid);
        db.prepare(
          `INSERT INTO product_barcodes (product_id, code, code_type, presentation_label, price_override)
           VALUES (?, ?, 'interno', ?, NULL)`
        ).run(newId, cleanInternal, cleanText(p.presentation, 100));
        if (cleanBarcode && cleanBarcode.toLowerCase() !== cleanInternal.toLowerCase()) {
          db.prepare(
            `INSERT INTO product_barcodes (product_id, code, code_type, presentation_label, price_override)
             VALUES (?, ?, 'comercial', ?, NULL)`
          ).run(newId, cleanBarcode, cleanText(p.presentation, 100));
        }
        if (stock > 0) {
          db.prepare(
            `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, batch_expiry, user_name)
             VALUES (?, 'entrada', ?, 0, ?, 'Stock inicial al registrar producto', ?, ?)`
          ).run(newId, stock, stock, p.expiry_date ? cleanText(p.expiry_date, 20) : null, req.user!.name);
        }
        return newId;
      })();

      logAudit(req.user!, 'Productos', 'Registro de producto', `Producto ${cleanInternal} - ${cleanName} creado.`);
      res.json(enrichProductsWithPromos([db.prepare('SELECT * FROM products WHERE id = ?').get(id)])[0]);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error al crear producto (verifique código único).' });
    }
  });

  app.put('/api/products/:id', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de producto inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }
    const p = req.body || {};
    const cleanInternal = cleanText(p.internal_code ?? existing.internal_code, 60);
    const cleanBarcode = cleanText(p.barcode ?? existing.barcode, 80);
    if (!cleanInternal) {
      res.status(400).json({ error: 'El código interno es obligatorio.' });
      return;
    }

    const newPurchase = parseNonNegativeNumber(p.purchase_price ?? existing.purchase_price);
    const newSale = parseNonNegativeNumber(p.sale_price ?? existing.sale_price);
    const newMinStock = parseNonNegativeNumber(p.min_stock ?? existing.min_stock);
    if (newPurchase === null || newSale === null || newSale <= 0 || newMinStock === null || !Number.isInteger(newMinStock)) {
      res.status(400).json({ error: 'Precios o stock mínimo inválidos.' });
      return;
    }

    if (cleanBarcode) {
      const dupBc = db
        .prepare('SELECT p.name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE LOWER(b.code) = LOWER(?) AND b.product_id != ?')
        .get(cleanBarcode, id) as any;
      if (dupBc) {
        res.status(400).json({ error: `El código de barras "${cleanBarcode}" ya pertenece a "${dupBc.name}".` });
        return;
      }
    }
    const dupInt = db
      .prepare('SELECT p.name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE LOWER(b.code) = LOWER(?) AND b.product_id != ?')
      .get(cleanInternal, id) as any;
    if (dupInt) {
      res.status(400).json({ error: `El código interno "${cleanInternal}" ya pertenece a "${dupInt.name}".` });
      return;
    }

    db.transaction(() => {
      if (newPurchase !== existing.purchase_price || newSale !== existing.sale_price) {
        db.prepare(
          `INSERT INTO price_history (product_id, old_purchase_price, new_purchase_price, old_sale_price, new_sale_price, changed_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, existing.purchase_price, newPurchase, existing.sale_price, newSale, req.user!.name);
      }

      db.prepare(
        `UPDATE products SET
          internal_code = ?, barcode = ?, name = ?, description = ?, brand = ?, presentation = ?, category = ?,
          purchase_price = ?, sale_price = ?, tax_rate = 0, min_stock = ?, expiry_date = ?, image_url = ?,
          is_featured = ?, is_bestseller = ?, is_active = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(
        cleanInternal,
        cleanBarcode,
        cleanText(p.name ?? existing.name, 160) || existing.name,
        cleanText(p.description ?? existing.description, 500),
        cleanText(p.brand ?? existing.brand, 100),
        cleanText(p.presentation ?? existing.presentation, 100),
        cleanText(p.category ?? existing.category, 80) || existing.category,
        newPurchase,
        newSale,
        newMinStock,
        p.expiry_date === undefined ? existing.expiry_date : (p.expiry_date ? cleanText(p.expiry_date, 20) : null),
        cleanText(p.image_url ?? existing.image_url, 1000),
        p.is_featured !== undefined ? (p.is_featured ? 1 : 0) : existing.is_featured,
        p.is_bestseller !== undefined ? (p.is_bestseller ? 1 : 0) : existing.is_bestseller,
        p.is_active !== undefined ? (p.is_active ? 1 : 0) : existing.is_active,
        id
      );

      if (cleanInternal !== existing.internal_code) {
        db.prepare("DELETE FROM product_barcodes WHERE product_id = ? AND LOWER(code) = LOWER(?)").run(id, existing.internal_code);
        db.prepare(
          "INSERT OR IGNORE INTO product_barcodes (product_id, code, code_type, presentation_label) VALUES (?, ?, 'interno', ?)"
        ).run(id, cleanInternal, cleanText(p.presentation ?? existing.presentation, 100));
      }
      if (cleanBarcode && cleanBarcode !== existing.barcode) {
        db.prepare(
          "INSERT OR IGNORE INTO product_barcodes (product_id, code, code_type, presentation_label) VALUES (?, ?, 'comercial', ?)"
        ).run(id, cleanBarcode, cleanText(p.presentation ?? existing.presentation, 100));
      }
    })();

    logAudit(req.user!, 'Productos', 'Edición de producto', `Producto ${cleanText(p.name ?? existing.name, 160)} actualizado.`);
    res.json(enrichProductsWithPromos([db.prepare('SELECT * FROM products WHERE id = ?').get(id)])[0]);
  });

  // --- BARCODES MODULE ---
  app.get('/api/barcodes/lookup/:code', requireAuth(['Administrador', 'Cajero', 'Encargado de inventario', 'Encargado de pedidos']), (req: AuthedRequest, res: Response) => {
    const code = cleanText(req.params.code, 80);
    if (!code) {
      res.status(400).json({ error: 'Código vacío.' });
      return;
    }
    const bc = db.prepare('SELECT * FROM product_barcodes WHERE LOWER(code) = LOWER(?)').get(code) as any;
    let prodRow: any = null;
    if (bc) {
      prodRow = db.prepare('SELECT * FROM products WHERE id = ?').get(bc.product_id);
    } else {
      prodRow = db.prepare('SELECT * FROM products WHERE LOWER(barcode) = LOWER(?) OR LOWER(internal_code) = LOWER(?)').get(code, code);
    }
    if (!prodRow) {
      res.status(404).json({ error: `El código "${code}" no está registrado en el catálogo.` });
      return;
    }
    const enriched = sanitizeProductForUser(enrichProductsWithPromos([prodRow])[0], req.user);
    res.json({ product: enriched, matched_barcode: bc || null });
  });

  app.post('/api/products/:id/barcodes', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const productId = parsePositiveInt(req.params.id);
    if (!productId) {
      res.status(400).json({ error: 'ID de producto inválido.' });
      return;
    }
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!prod) {
      res.status(404).json({ error: 'Producto no encontrado.' });
      return;
    }
    const code = cleanText(req.body?.code, 80);
    const codeType = req.body?.code_type === 'interno' ? 'interno' : 'comercial';
    const presentationLabel = cleanText(req.body?.presentation_label || prod.presentation || '', 100);
    let priceOverride: number | null = null;
    if (req.body?.price_override !== undefined && req.body?.price_override !== '' && req.body?.price_override !== null) {
      const parsedOverride = parseNonNegativeNumber(req.body.price_override);
      if (parsedOverride === null) {
        res.status(400).json({ error: 'El precio especial debe ser mayor o igual a 0.' });
        return;
      }
      priceOverride = parsedOverride;
    }

    if (!code) {
      res.status(400).json({ error: 'Ingrese un código válido.' });
      return;
    }
    const dup = db.prepare('SELECT p.name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE LOWER(b.code) = LOWER(?)').get(code) as any;
    if (dup) {
      res.status(400).json({ error: `El código "${code}" ya está asignado al producto "${dup.name}". No se permiten códigos duplicados.` });
      return;
    }

    const result = db
      .prepare('INSERT INTO product_barcodes (product_id, code, code_type, presentation_label, price_override) VALUES (?, ?, ?, ?, ?)')
      .run(productId, code, codeType, presentationLabel, priceOverride);

    if (!prod.barcode && codeType === 'comercial') {
      db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(code, productId);
    }

    logAudit(req.user!, 'Códigos de barras', 'Asociación de código', `Código ${code} (${codeType}) asociado a ${prod.name}.`);
    res.json(db.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(Number(result.lastInsertRowid)));
  });

  app.delete('/api/products/:id/barcodes/:barcodeId', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const productId = parsePositiveInt(req.params.id);
    const barcodeId = parsePositiveInt(req.params.barcodeId);
    if (!productId || !barcodeId) {
      res.status(400).json({ error: 'Identificadores inválidos.' });
      return;
    }
    const bc = db.prepare('SELECT * FROM product_barcodes WHERE id = ? AND product_id = ?').get(barcodeId, productId) as any;
    if (!bc) {
      res.status(404).json({ error: 'Código no encontrado.' });
      return;
    }
    db.prepare('DELETE FROM product_barcodes WHERE id = ?').run(barcodeId);
    logAudit(req.user!, 'Códigos de barras', 'Eliminación de código', `Código ${bc.code} desvinculado del producto #${productId}.`);
    res.json({ ok: true });
  });

  app.post('/api/products/:id/generate-internal-barcode', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const productId = parsePositiveInt(req.params.id);
    if (!productId) {
      res.status(400).json({ error: 'ID de producto inválido.' });
      return;
    }
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!prod) {
      res.status(404).json({ error: 'Producto no encontrado.' });
      return;
    }
    const baseDigits = `200${String(productId).padStart(9, '0')}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += Number(baseDigits[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    const generatedCode = `${baseDigits}${checkDigit}`;

    const dup = db.prepare('SELECT id FROM product_barcodes WHERE LOWER(code) = LOWER(?)').get(generatedCode);
    if (dup) {
      res.status(400).json({ error: 'El código interno generado ya existe.' });
      return;
    }

    const result = db
      .prepare("INSERT INTO product_barcodes (product_id, code, code_type, presentation_label, price_override) VALUES (?, ?, 'interno', ?, NULL)")
      .run(productId, generatedCode, prod.presentation || 'Etiqueta interna');

    if (!prod.barcode) {
      db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(generatedCode, productId);
    }

    logAudit(req.user!, 'Códigos de barras', 'Generación código interno', `Código interno EAN-13 ${generatedCode} asignado a ${prod.name}.`);
    res.json(db.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(Number(result.lastInsertRowid)));
  });

  app.get('/api/products/:id/price-history', requireAuth(['Administrador', 'Encargado de inventario']), (req: Request, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const rows = db.prepare('SELECT * FROM price_history WHERE product_id = ? ORDER BY id DESC').all(id);
    res.json(rows);
  });

  app.post('/api/products/import', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
    let imported = 0;
    let updated = 0;

    const tx = db.transaction(() => {
      for (const r of rows) {
        const internalCode = cleanText(r?.internal_code, 60);
        const name = cleanText(r?.name, 160);
        if (!internalCode || !name) continue;
        const existing = db.prepare('SELECT * FROM products WHERE internal_code = ?').get(internalCode) as any;
        const purchasePrice = parseNonNegativeNumber(r.purchase_price ?? existing?.purchase_price ?? 0);
        const salePrice = parseNonNegativeNumber(r.sale_price ?? existing?.sale_price ?? 0);
        const stock = parseNonNegativeNumber(r.stock ?? existing?.stock ?? 0);
        const minStock = parseNonNegativeNumber(r.min_stock ?? existing?.min_stock ?? 5);
        if (purchasePrice === null || salePrice === null || stock === null || minStock === null) continue;

        if (existing) {
          db.prepare(
            `UPDATE products SET
              barcode = ?, name = ?, description = ?, brand = ?, presentation = ?, category = ?,
              purchase_price = ?, sale_price = ?, stock = ?, min_stock = ?, updated_at = datetime('now', 'localtime')
             WHERE id = ?`
          ).run(
            cleanText(r.barcode || existing.barcode, 80),
            name,
            cleanText(r.description || existing.description, 500),
            cleanText(r.brand || existing.brand, 100),
            cleanText(r.presentation || existing.presentation, 100),
            cleanText(r.category || existing.category, 80),
            purchasePrice,
            salePrice,
            Math.floor(stock),
            Math.floor(minStock),
            existing.id
          );
          updated++;
        } else {
          db.prepare(
            `INSERT INTO products (
              internal_code, barcode, name, description, brand, presentation, category,
              purchase_price, sale_price, tax_rate, stock, min_stock, image_url, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '', 1)`
          ).run(
            internalCode,
            cleanText(r.barcode, 80),
            name,
            cleanText(r.description, 500),
            cleanText(r.brand, 100),
            cleanText(r.presentation, 100),
            cleanText(r.category || 'Abarrotes', 80),
            purchasePrice,
            salePrice,
            Math.floor(stock),
            Math.floor(minStock)
          );
          imported++;
        }
      }
    });
    tx();

    logAudit(req.user!, 'Productos', 'Importación Excel', `Importados ${imported} nuevos, actualizados ${updated} productos.`);
    res.json({ imported, updated });
  });

  // --- PROMOTIONS ---
  app.get('/api/promotions', (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT p.*, pr.name as target_product_name
         FROM promotions p
         LEFT JOIN products pr ON pr.id = p.target_product_id
         ORDER BY p.id DESC`
      )
      .all();
    res.json(rows);
  });

  app.post('/api/promotions', requireAuth(['Administrador']), (req: AuthedRequest, res: Response) => {
    const p = req.body || {};
    const title = cleanText(p.title, 140);
    const scope = p.scope === 'category' ? 'category' : 'product';
    const discountType = p.discount_type === 'special_price' ? 'special_price' : 'percentage';
    const discountValue = parseNonNegativeNumber(p.discount_value);
    if (!title || !p.start_date || !p.end_date || discountValue === null) {
      res.status(400).json({ error: 'Complete título, fechas y valor de descuento válido.' });
      return;
    }
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      res.status(400).json({ error: 'El porcentaje de descuento debe estar entre 1 y 100.' });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO promotions (
          title, description, scope, target_product_id, target_category,
          discount_type, discount_value, start_date, end_date, publish_in_app, is_active, banner_image_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title,
        cleanText(p.description, 400),
        scope,
        p.target_product_id ? parsePositiveInt(p.target_product_id) : null,
        p.target_category ? cleanText(p.target_category, 80) : null,
        discountType,
        discountValue,
        cleanText(p.start_date, 20),
        cleanText(p.end_date, 20),
        p.publish_in_app ? 1 : 0,
        p.is_active ? 1 : 0,
        cleanText(p.banner_image_url, 1000)
      );
    logAudit(req.user!, 'Promociones', 'Nueva promoción', `Promoción "${title}" creada.`);
    res.json(db.prepare('SELECT * FROM promotions WHERE id = ?').get(Number(result.lastInsertRowid)));
  });

  app.put('/api/promotions/:id', requireAuth(['Administrador']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const p = req.body || {};
    const title = cleanText(p.title, 140);
    const scope = p.scope === 'category' ? 'category' : 'product';
    const discountType = p.discount_type === 'special_price' ? 'special_price' : 'percentage';
    const discountValue = parseNonNegativeNumber(p.discount_value);
    if (!title || !p.start_date || !p.end_date || discountValue === null) {
      res.status(400).json({ error: 'Complete título, fechas y valor de descuento válido.' });
      return;
    }
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      res.status(400).json({ error: 'El porcentaje de descuento debe estar entre 1 y 100.' });
      return;
    }

    db.prepare(
      `UPDATE promotions SET
        title = ?, description = ?, scope = ?, target_product_id = ?, target_category = ?,
        discount_type = ?, discount_value = ?, start_date = ?, end_date = ?, publish_in_app = ?, is_active = ?, banner_image_url = ?
       WHERE id = ?`
    ).run(
      title,
      cleanText(p.description, 400),
      scope,
      p.target_product_id ? parsePositiveInt(p.target_product_id) : null,
      p.target_category ? cleanText(p.target_category, 80) : null,
      discountType,
      discountValue,
      cleanText(p.start_date, 20),
      cleanText(p.end_date, 20),
      p.publish_in_app ? 1 : 0,
      p.is_active ? 1 : 0,
      cleanText(p.banner_image_url, 1000),
      id
    );
    logAudit(req.user!, 'Promociones', 'Actualización de promoción', `Promoción #${id} (${title}) actualizada.`);
    res.json(db.prepare('SELECT * FROM promotions WHERE id = ?').get(id));
  });

  // --- ONLINE ORDERS & POS SALES ---
  app.post('/api/orders/online', (req: Request, res: Response) => {
    const body = req.body || {};
    const authedUser = getUserFromRequest(req);
    const itemsReq = Array.isArray(body.items) ? body.items : [];
    if (itemsReq.length === 0 || itemsReq.length > 200) {
      res.status(400).json({ error: 'El carrito debe contener entre 1 y 200 líneas de producto.' });
      return;
    }

    const customerName = cleanText(body.customer_name, 120);
    const customerPhone = cleanText(body.customer_phone, 40);
    const customerRtn = cleanText(body.customer_rtn, 30);
    const deliveryAddress = cleanText(body.delivery_address, 300);
    const deliveryReference = cleanText(body.delivery_reference, 250);
    const deliveryNotes = cleanText(body.delivery_notes, 300);

    if (customerName.length < 2 || customerPhone.length < 6) {
      res.status(400).json({ error: 'Nombre y teléfono válidos son obligatorios.' });
      return;
    }
    if (!isValidTransferProof(body.transfer_proof_url)) {
      res.status(400).json({ error: 'El comprobante de transferencia debe ser una imagen válida (PNG, JPG, WEBP o GIF).' });
      return;
    }

    const settings = getParsedSettings();
    const deliveryMode = body.delivery_mode === 'recoger' ? 'recoger' : 'domicilio';
    let deliveryFee = 0;
    let zoneName = 'Recoger en tienda';
    let selectedZoneId = 'centro';

    if (deliveryMode === 'domicilio') {
      if (deliveryAddress.length < 5) {
        res.status(400).json({ error: 'Ingrese una dirección de entrega válida para envío a domicilio.' });
        return;
      }
      const activeZones = (settings.delivery_zones || []).filter((z: any) => z.active !== false);
      if (body.zone_id) {
        const zone = activeZones.find((z: any) => z.id === String(body.zone_id));
        if (!zone) {
          res.status(400).json({ error: 'La zona de entrega seleccionada no es válida o está inactiva.' });
          return;
        }
        deliveryFee = Math.max(0, Number(zone.fee) || 0);
        zoneName = zone.name;
        selectedZoneId = zone.id;
      } else if (activeZones.length > 0) {
        deliveryFee = Math.max(0, Number(activeZones[0].fee) || 0);
        zoneName = activeZones[0].name;
        selectedZoneId = activeZones[0].id;
      } else {
        deliveryFee = 35;
        zoneName = 'Zona estándar';
      }

      if (body.delivery_lat !== undefined && body.delivery_lat !== null && body.delivery_lng !== undefined && body.delivery_lng !== null) {
        if (!isValidCoord(body.delivery_lat, body.delivery_lng)) {
          res.status(400).json({ error: 'Las coordenadas de entrega son inválidas.' });
          return;
        }
      }
    }

    try {
      const createdResult = db.transaction(() => {
        const enrichedAll = enrichProductsWithPromos(db.prepare('SELECT * FROM products').all());
        const prodMap = new Map(enrichedAll.map((p) => [p.id, p]));

        // Aggregate requested quantities per product_id to prevent split-line stock bypass
        const requestedTotals = new Map<number, number>();
        const parsedLines: Array<{ product_id: number; quantity: number }> = [];
        for (const reqItem of itemsReq) {
          const productId = parsePositiveInt(reqItem?.product_id);
          const qty = parsePositiveInt(reqItem?.quantity);
          if (!productId || !qty || qty > 500) {
            throw new Error('Uno de los productos o cantidades del carrito es inválido.');
          }
          parsedLines.push({ product_id: productId, quantity: qty });
          requestedTotals.set(productId, (requestedTotals.get(productId) || 0) + qty);
        }

        for (const [productId, totalQty] of requestedTotals.entries()) {
          const prod = prodMap.get(productId);
          if (!prod || !prod.is_active) throw new Error('Uno de los productos ya no está disponible.');
          if (prod.stock < totalQty) throw new Error(`Stock insuficiente para ${prod.name} (disponibles: ${prod.stock}).`);
        }

        let subtotal = 0;
        let discountTotal = 0;
        const taxTotal = 0;
        const preparedItems: any[] = [];

        for (const line of parsedLines) {
          const prod = prodMap.get(line.product_id)!;
          const qty = line.quantity;
          const effectivePrice = prod.promo_price ?? prod.sale_price;
          const unitDiscount = Math.max(0, prod.sale_price - effectivePrice);
          const lineTotal = Number((effectivePrice * qty).toFixed(2));
          const lineDiscount = Number((unitDiscount * qty).toFixed(2));

          subtotal += Number((prod.sale_price * qty).toFixed(2));
          discountTotal += lineDiscount;

          preparedItems.push({
            product_id: prod.id,
            product_name: prod.name,
            internal_code: prod.internal_code,
            quantity: qty,
            unit_price: prod.sale_price,
            discount_amount: lineDiscount,
            tax_rate: 0,
            line_total: lineTotal,
          });
        }

        const total = Number((subtotal - discountTotal + deliveryFee).toFixed(2));
        if (!Number.isFinite(total) || total <= 0) {
          throw new Error('No se pudo calcular el total del pedido.');
        }
        if (deliveryMode === 'domicilio' && subtotal - discountTotal < settings.min_order_amount) {
          throw new Error(`El monto mínimo para envío a domicilio es L. ${settings.min_order_amount.toFixed(2)}.`);
        }

        // Find or create customer without linking guest phone numbers to registered accounts
        let customerId: number | null = null;
        if (authedUser) {
          const cust = db.prepare('SELECT id FROM customers WHERE user_id = ?').get(authedUser.id) as any;
          if (cust) customerId = cust.id;
        }
        if (!customerId) {
          const byGuestPhone = authedUser
            ? null
            : (db.prepare('SELECT id FROM customers WHERE phone = ? AND user_id IS NULL').get(customerPhone) as any);
          if (byGuestPhone) {
            customerId = byGuestPhone.id;
          } else {
            const cRes = db
              .prepare('INSERT INTO customers (name, phone, email, rtn, razon_social, addresses, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(
                customerName,
                customerPhone,
                authedUser?.email || '',
                customerRtn,
                customerName,
                deliveryAddress
                  ? JSON.stringify([{ id: 'addr-init', label: 'Dirección principal', address: deliveryAddress, reference: deliveryReference, zone_id: selectedZoneId }])
                  : '[]',
                authedUser?.id || null
              );
            customerId = Number(cRes.lastInsertRowid);
          }
        }

        const countRow = db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number };
        const orderNumber = `PED-2026-${String(countRow.c + 141).padStart(4, '0')}`;
        const trackingToken = crypto.randomBytes(16).toString('hex');

        const defCoords = getZoneDefaultCoords(selectedZoneId);
        const deliveryLat = deliveryMode === 'domicilio'
          ? (body.delivery_lat !== undefined && body.delivery_lat !== null && isValidCoord(body.delivery_lat, body.delivery_lng) ? Number(body.delivery_lat) : defCoords.lat)
          : null;
        const deliveryLng = deliveryMode === 'domicilio'
          ? (body.delivery_lng !== undefined && body.delivery_lng !== null && isValidCoord(body.delivery_lat, body.delivery_lng) ? Number(body.delivery_lng) : defCoords.lng)
          : null;
        const estDistKm = deliveryLat !== null && deliveryLng !== null
          ? Number((haversineKm(settings.store_lat, settings.store_lng, deliveryLat, deliveryLng) * 1.25).toFixed(2))
          : null;
        const estDurMin = estDistKm !== null ? Math.max(4, Math.round((estDistKm / 26) * 60)) : null;

        const oRes = db
          .prepare(
            `INSERT INTO orders (
              order_number, tracking_token, channel, customer_id, customer_name, customer_phone, customer_rtn,
              delivery_mode, delivery_address, delivery_reference, delivery_notes, delivery_zone_name,
              delivery_fee, delivery_lat, delivery_lng, estimated_distance_km, estimated_duration_min,
              payment_method, transfer_proof_url, cash_received, change_given,
              subtotal, discount_total, tax_total, total, status, created_by_user_id, created_by_name
            ) VALUES (?, ?, 'online', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'recibido', ?, ?)`
          )
          .run(
            orderNumber,
            trackingToken,
            customerId,
            customerName,
            customerPhone,
            customerRtn,
            deliveryMode,
            deliveryAddress,
            deliveryReference,
            deliveryNotes,
            zoneName,
            deliveryFee,
            deliveryLat,
            deliveryLng,
            estDistKm,
            estDurMin,
            body.payment_method === 'transferencia' ? 'transferencia' : 'efectivo',
            cleanText(body.transfer_proof_url, 5_000_000),
            Number(subtotal.toFixed(2)),
            Number(discountTotal.toFixed(2)),
            Number(taxTotal.toFixed(2)),
            total,
            authedUser?.id || null,
            customerName
          );

        const orderId = Number(oRes.lastInsertRowid);
        for (const item of preparedItems) {
          const currentProd = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id) as { stock: number };
          db.prepare(
            `INSERT INTO order_items (order_id, product_id, product_name, internal_code, quantity, unit_price, discount_amount, tax_rate, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(orderId, item.product_id, item.product_name, item.internal_code, item.quantity, item.unit_price, item.discount_amount, item.tax_rate, item.line_total);

          const newStock = currentProd.stock - item.quantity;
          db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(newStock, item.product_id);
          db.prepare(
            `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, user_name)
             VALUES (?, 'pedido_online', ?, ?, ?, ?, ?)`
          ).run(item.product_id, -item.quantity, currentProd.stock, newStock, `Pedido en línea ${orderNumber}`, customerName);
        }

        logAudit(authedUser || { name: customerName, role: 'Cliente' }, 'Pedidos en línea', 'Nuevo pedido', `Pedido ${orderNumber} por L. ${total.toFixed(2)}.`);
        return {
          order: hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
          trackingToken,
        };
      })();

      broadcastRoom('admin', { type: 'order:created', order: createdResult.order });
      res.json({ ...createdResult.order, tracking_token: createdResult.trackingToken });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'No se pudo procesar el pedido.' });
    }
  });

  app.post('/api/orders/pos', requireAuth(['Administrador', 'Cajero']), (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const itemsReq = Array.isArray(body.items) ? body.items : [];
    if (itemsReq.length === 0 || itemsReq.length > 300) {
      res.status(400).json({ error: 'Agregue entre 1 y 300 líneas de producto a la venta.' });
      return;
    }

    const extraDiscount = parseNonNegativeNumber(body.extra_discount ?? 0);
    if (extraDiscount === null) {
      res.status(400).json({ error: 'El descuento adicional no puede ser negativo o inválido.' });
      return;
    }

    const openSession = db.prepare("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY id DESC LIMIT 1").get() as any;
    if (!openSession) {
      res.status(400).json({ error: 'Debe realizar la apertura de caja antes de registrar ventas en el POS.' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const enrichedAll = enrichProductsWithPromos(db.prepare('SELECT * FROM products').all());
        const prodMap = new Map(enrichedAll.map((p) => [p.id, p]));

        // Aggregate quantities per product_id before checking stock
        const requestedTotals = new Map<number, number>();
        const parsedLines: Array<{ product_id: number; quantity: number; barcode_id?: number | null }> = [];
        for (const reqItem of itemsReq) {
          const productId = parsePositiveInt(reqItem?.product_id);
          const qty = parsePositiveInt(reqItem?.quantity);
          if (!productId || !qty || qty > 1000) {
            throw new Error('Uno de los productos o cantidades es inválido.');
          }
          parsedLines.push({ product_id: productId, quantity: qty, barcode_id: reqItem?.barcode_id ? parsePositiveInt(reqItem.barcode_id) : null });
          requestedTotals.set(productId, (requestedTotals.get(productId) || 0) + qty);
        }

        for (const [productId, totalQty] of requestedTotals.entries()) {
          const prod = prodMap.get(productId);
          if (!prod) throw new Error('Producto no encontrado.');
          if (prod.stock < totalQty) throw new Error(`Stock insuficiente para ${prod.name} (disponible: ${prod.stock}).`);
        }

        let subtotal = 0;
        let promoDiscount = 0;
        const taxTotal = 0;
        const preparedItems: any[] = [];

        for (const line of parsedLines) {
          const prod = prodMap.get(line.product_id)!;
          const qty = line.quantity;
          const matchedBc = line.barcode_id
            ? (prod.barcodes || []).find((b: any) => b.id === line.barcode_id)
            : null;
          const baseUnitPrice = matchedBc?.price_override !== null && matchedBc?.price_override !== undefined
            ? Number(matchedBc.price_override)
            : prod.sale_price;
          const effectivePrice = matchedBc?.price_override !== null && matchedBc?.price_override !== undefined
            ? Number(matchedBc.price_override)
            : (prod.promo_price ?? prod.sale_price);

          const lineBase = Number((baseUnitPrice * qty).toFixed(2));
          const lineEffective = Number((effectivePrice * qty).toFixed(2));
          const linePromoDisc = Number(Math.max(0, lineBase - lineEffective).toFixed(2));

          subtotal += lineBase;
          promoDiscount += linePromoDisc;

          const labelSuffix = matchedBc?.presentation_label && matchedBc.presentation_label !== prod.presentation
            ? ` (${matchedBc.presentation_label})`
            : '';

          preparedItems.push({
            product_id: prod.id,
            product_name: `${prod.name}${labelSuffix}`,
            internal_code: matchedBc?.code || prod.internal_code,
            quantity: qty,
            unit_price: baseUnitPrice,
            discount_amount: linePromoDisc,
            tax_rate: 0,
            line_total: lineEffective,
          });
        }

        const netAfterPromos = Number((subtotal - promoDiscount).toFixed(2));
        if (extraDiscount > netAfterPromos) {
          throw new Error('El descuento adicional no puede superar el subtotal de la venta.');
        }

        const totalDiscount = Number((promoDiscount + extraDiscount).toFixed(2));
        const total = Math.max(0, Number((subtotal - totalDiscount).toFixed(2)));
        const paymentMethod = body.payment_method === 'transferencia' ? 'transferencia' : 'efectivo';

        let cashReceived = 0;
        if (paymentMethod === 'efectivo') {
          const parsedCash =
            body.cash_received === undefined || body.cash_received === null || body.cash_received === ''
              ? total
              : parseNonNegativeNumber(body.cash_received);
          if (parsedCash === null || parsedCash < total) {
            throw new Error('El efectivo recibido no puede ser menor al total de la venta.');
          }
          cashReceived = parsedCash;
        }
        const changeGiven = paymentMethod === 'efectivo' ? Number((cashReceived - total).toFixed(2)) : 0;

        let validCustomerId: number | null = null;
        if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== '') {
          const cid = parsePositiveInt(body.customer_id);
          if (cid && db.prepare('SELECT id FROM customers WHERE id = ?').get(cid)) {
            validCustomerId = cid;
          }
        }

        const countRow = db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number };
        const orderNumber = `POS-2026-${String(countRow.c + 141).padStart(4, '0')}`;
        const trackingToken = crypto.randomBytes(16).toString('hex');

        const oRes = db
          .prepare(
            `INSERT INTO orders (
              order_number, tracking_token, channel, customer_id, customer_name, customer_phone, customer_rtn,
              delivery_mode, delivery_address, delivery_zone_name, delivery_fee,
              payment_method, transfer_proof_url, cash_received, change_given,
              subtotal, discount_total, tax_total, total, status,
              created_by_user_id, created_by_name
            ) VALUES (?, ?, 'pos', ?, ?, ?, ?, 'recoger', 'Tienda Física', 'Mostrador', 0, ?, ?, ?, ?, ?, ?, ?, ?, 'entregado', ?, ?)`
          )
          .run(
            orderNumber,
            trackingToken,
            validCustomerId,
            cleanText(body.customer_name, 120) || 'Consumidor Final',
            cleanText(body.customer_phone, 40),
            cleanText(body.customer_rtn, 30) || '00000000000000',
            paymentMethod,
            cleanText(body.transfer_reference, 200),
            cashReceived,
            changeGiven,
            Number(subtotal.toFixed(2)),
            totalDiscount,
            Number(taxTotal.toFixed(2)),
            total,
            req.user!.id,
            req.user!.name
          );

        const orderId = Number(oRes.lastInsertRowid);
        for (const item of preparedItems) {
          const currentProd = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id) as { stock: number };
          db.prepare(
            `INSERT INTO order_items (order_id, product_id, product_name, internal_code, quantity, unit_price, discount_amount, tax_rate, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(orderId, item.product_id, item.product_name, item.internal_code, item.quantity, item.unit_price, item.discount_amount, item.tax_rate, item.line_total);

          const newStock = currentProd.stock - item.quantity;
          db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(newStock, item.product_id);
          db.prepare(
            `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, user_name)
             VALUES (?, 'venta_pos', ?, ?, ?, ?, ?)`
          ).run(item.product_id, -item.quantity, currentProd.stock, newStock, `Venta presencial ${orderNumber}`, req.user!.name);
        }

        const invoice = generateInvoiceForOrder(orderId, req.user!.name);
        logAudit(req.user!, 'POS', 'Venta registrada', `Venta ${orderNumber} por L. ${total.toFixed(2)} (${paymentMethod}). Factura ${invoice.invoice_number}.`);

        return { order: hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)), invoice };
      })();

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error al registrar la venta POS.' });
    }
  });

  app.get('/api/orders/track/:orderNumber', (req: Request, res: Response) => {
    const orderNumber = cleanText(req.params.orderNumber, 40);
    if (!orderNumber) {
      res.status(400).json({ error: 'Número de pedido requerido.' });
      return;
    }
    const order = db.prepare('SELECT * FROM orders WHERE UPPER(order_number) = UPPER(?)').get(orderNumber) as any;
    if (!order) {
      res.status(404).json({ error: 'No se encontró ningún pedido con ese número.' });
      return;
    }

    const authedUser = getUserFromRequest(req);
    const providedToken = cleanText(req.get('x-tracking-token') || req.query.tracking_token, 128);
    const isStaffAllowed = Boolean(authedUser && ['Administrador', 'Encargado de pedidos', 'Cajero'].includes(authedUser.role));
    const isCreator = Boolean(authedUser && order.created_by_user_id !== null && order.created_by_user_id === authedUser.id);
    const isAssignedDriver = Boolean(authedUser && authedUser.role === 'Repartidor' && order.assigned_driver_id === authedUser.id);
    const hasGuestToken = Boolean(providedToken && order.tracking_token && safeTimingEqual(providedToken, String(order.tracking_token)));

    if (!isStaffAllowed && !isCreator && !isAssignedDriver && !hasGuestToken) {
      if (!authedUser && !providedToken) {
        res.status(401).json({ error: 'Inicie sesión con su cuenta para consultar este pedido.' });
      } else {
        res.status(403).json({ error: 'No tiene permisos para consultar este pedido.' });
      }
      return;
    }

    const settings = getParsedSettings();
    const hydrated = hydrateOrder(order);
    if (hydrated && !isStaffAllowed && !isCreator && !isAssignedDriver) {
      hydrated.customer_rtn = '';
      hydrated.transfer_proof_url = '';
    }

    // STRICT PRIVACY ISOLATION: Customer ONLY receives assigned driver's live location
    // while status === 'en_camino' AND tracking is active for THIS exact order.
    let driverLocation: any = null;
    if (order.status === 'en_camino' && order.assigned_driver_id && order.delivery_mode === 'domicilio') {
      const loc = db
        .prepare('SELECT driver_id, order_id, lat, lng, heading, speed_kmh, accuracy_m, is_tracking, updated_at FROM driver_locations WHERE driver_id = ? AND order_id = ? AND is_tracking = 1')
        .get(order.assigned_driver_id, order.id) as any;
      if (loc) {
        let remainingKm = order.estimated_distance_km || null;
        let etaMin = order.estimated_duration_min || null;
        if (order.delivery_lat && order.delivery_lng) {
          remainingKm = Number((haversineKm(loc.lat, loc.lng, order.delivery_lat, order.delivery_lng) * 1.2).toFixed(2));
          etaMin = Math.max(1, Math.round((remainingKm / 26) * 60));
        }
        driverLocation = { ...loc, remaining_km: remainingKm, eta_min: etaMin };
      }
    }

    const notifications = db
      .prepare("SELECT * FROM delivery_notifications WHERE order_id = ? AND target_role = 'customer' ORDER BY id DESC LIMIT 10")
      .all(order.id);

    res.json({
      ...hydrated,
      store: {
        name: settings.business_name,
        address: settings.address,
        hours: settings.hours,
        lat: settings.store_lat,
        lng: settings.store_lng,
      },
      driver_location: driverLocation,
      notifications,
    });
  });

  app.get('/api/orders', requireAuth(), (req: AuthedRequest, res: Response) => {
    const channel = req.query.channel as string | undefined;
    let rows: any[];
    if (req.user!.role === 'Repartidor') {
      rows = db
        .prepare("SELECT * FROM orders WHERE channel = 'online' AND delivery_mode = 'domicilio' AND assigned_driver_id = ? ORDER BY id DESC")
        .all(req.user!.id);
    } else if (req.user!.role === 'Cliente') {
      rows = db.prepare('SELECT * FROM orders WHERE created_by_user_id = ? ORDER BY id DESC').all(req.user!.id);
    } else if (channel) {
      rows = db.prepare('SELECT * FROM orders WHERE channel = ? ORDER BY id DESC').all(channel);
    } else {
      rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    }
    res.json(rows.map(hydrateOrder));
  });

  app.put('/api/orders/:id/status', requireAuth(['Administrador', 'Encargado de pedidos', 'Repartidor', 'Cajero']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de pedido inválido.' });
      return;
    }
    const { status, rejection_reason, assigned_driver_id } = req.body || {};
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    const nextStatus = status ? cleanText(status, 40) : existing.status;
    if (!ALLOWED_ORDER_STATUSES.has(nextStatus)) {
      res.status(400).json({ error: 'Estado de pedido inválido.' });
      return;
    }

    if (req.user!.role === 'Repartidor') {
      if (existing.assigned_driver_id !== req.user!.id) {
        res.status(403).json({ error: 'Solo puede actualizar pedidos asignados a usted.' });
        return;
      }
      if (!['en_camino', 'entregado'].includes(nextStatus)) {
        res.status(403).json({ error: 'Un repartidor solo puede marcar el pedido en camino o entregado.' });
        return;
      }
      if (assigned_driver_id !== undefined && Number(assigned_driver_id) !== req.user!.id) {
        res.status(403).json({ error: 'No puede reasignar el pedido a otro repartidor.' });
        return;
      }
    }

    let driverId = existing.assigned_driver_id;
    let driverName = existing.assigned_driver_name;
    let newlyAssignedDriverId: number | null = null;

    if (assigned_driver_id !== undefined) {
      if (assigned_driver_id) {
        const parsedDrvId = parsePositiveInt(assigned_driver_id);
        const drv = parsedDrvId
          ? (db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'Repartidor' AND is_active = 1").get(parsedDrvId) as any)
          : null;
        if (!drv) {
          res.status(400).json({ error: 'El repartidor seleccionado no es válido o está inactivo.' });
          return;
        }
        if (existing.assigned_driver_id !== drv.id) {
          newlyAssignedDriverId = drv.id;
        }
        driverId = drv.id;
        driverName = drv.name;
      } else {
        driverId = null;
        driverName = '';
      }
    }

    const cleanRejectionReason = rejection_reason !== undefined ? cleanText(rejection_reason, 300) : existing.rejection_reason;

    db.transaction(() => {
      // Restore stock if newly rejected or cancelled
      if ((nextStatus === 'rechazado' || nextStatus === 'cancelado') && existing.status !== 'rechazado' && existing.status !== 'cancelado') {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
        for (const item of items) {
          const prod = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id) as any;
          if (prod) {
            const newStock = prod.stock + item.quantity;
            db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(newStock, item.product_id);
            db.prepare(
              `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, user_name)
               VALUES (?, 'devolucion', ?, ?, ?, ?, ?)`
            ).run(item.product_id, item.quantity, prod.stock, newStock, `Pedido ${existing.order_number} ${nextStatus}`, req.user!.name);
          }
        }
      }

      const dispatchedClause = nextStatus === 'en_camino' && !existing.dispatched_at ? ", dispatched_at = datetime('now', 'localtime')" : '';
      const deliveredClause = nextStatus === 'entregado' && !existing.delivered_at ? ", delivered_at = datetime('now', 'localtime')" : '';

      db.prepare(
        `UPDATE orders SET status = ?, rejection_reason = ?, assigned_driver_id = ?, assigned_driver_name = ?, updated_at = datetime('now', 'localtime')${dispatchedClause}${deliveredClause} WHERE id = ?`
      ).run(nextStatus, cleanRejectionReason, driverId, driverName, id);

      if (nextStatus === 'confirmado' && existing.channel === 'online') {
        generateInvoiceForOrder(id, req.user!.name);
      }

      // Stop GPS tracking immediately when delivered, rejected, or cancelled
      if (nextStatus === 'entregado' || nextStatus === 'rechazado' || nextStatus === 'cancelado') {
        db.prepare('UPDATE driver_locations SET is_tracking = 0, order_id = NULL WHERE order_id = ?').run(id);
      }

      if (newlyAssignedDriverId) {
        db.prepare(
          `INSERT INTO delivery_notifications (order_id, target_role, target_user_id, event_type, title, message)
           VALUES (?, 'driver', ?, 'driver_assigned', ?, ?)`
        ).run(id, newlyAssignedDriverId, 'Nueva entrega asignada', `Pedido ${existing.order_number} para ${existing.customer_name} (${existing.delivery_address || 'Domicilio'}).`);
      }

      if (nextStatus === 'en_camino' && existing.status !== 'en_camino') {
        db.prepare(
          `INSERT INTO delivery_notifications (order_id, target_role, target_user_id, event_type, title, message)
           VALUES (?, 'customer', ?, 'order_dispatched', ?, ?)`
        ).run(
          id,
          existing.created_by_user_id || null,
          'Tu pedido salió del establecimiento',
          `${driverName ? `El repartidor ${driverName} va en camino` : 'Tu pedido va en camino'} hacia ${existing.delivery_address}.`
        );
      }

      if (nextStatus === 'entregado' && existing.status !== 'entregado') {
        db.prepare(
          `INSERT INTO delivery_notifications (order_id, target_role, target_user_id, event_type, title, message)
           VALUES (?, 'customer', ?, 'order_delivered', ?, ?)`
        ).run(id, existing.created_by_user_id || null, 'Pedido entregado', `Tu pedido ${existing.order_number} ha sido entregado. ¡Gracias por tu compra!`);
      }
    })();

    const updatedOrder = hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));

    // Real-time WebSocket broadcasts
    if (newlyAssignedDriverId) {
      broadcastRoom(`driver:${newlyAssignedDriverId}`, { type: 'driver:assigned', order: updatedOrder });
    }
    broadcastRoom(`order:${existing.order_number}`, { type: 'order:updated', order: updatedOrder });
    if (nextStatus === 'entregado' || nextStatus === 'rechazado' || nextStatus === 'cancelado') {
      broadcastRoom(`order:${existing.order_number}`, { type: 'tracking:stopped', order_id: id, order_number: existing.order_number, status: nextStatus });
    }
    broadcastRoom('admin', { type: 'order:updated', order: updatedOrder });

    logAudit(req.user!, 'Pedidos', 'Cambio de estado', `Pedido ${existing.order_number} -> ${nextStatus}${cleanRejectionReason ? ` (${cleanRejectionReason})` : ''}.`);
    res.json(updatedOrder);
  });

  // --- REAL-TIME DELIVERY, GPS TRACKING & NOTIFICATIONS ---
  app.get('/api/driver/deliveries', requireAuth(['Repartidor', 'Administrador']), (req: AuthedRequest, res: Response) => {
    const settings = getParsedSettings();
    const rows = req.user!.role === 'Administrador'
      ? db.prepare("SELECT * FROM orders WHERE channel = 'online' AND delivery_mode = 'domicilio' ORDER BY id DESC").all()
      : db.prepare("SELECT * FROM orders WHERE channel = 'online' AND delivery_mode = 'domicilio' AND assigned_driver_id = ? ORDER BY id DESC").all(req.user!.id);

    const notifications = db
      .prepare(
        `SELECT n.*, o.order_number FROM delivery_notifications n
         JOIN orders o ON o.id = n.order_id
         WHERE n.target_role = 'driver' AND (n.target_user_id = ? OR ? = 'Administrador')
         ORDER BY n.id DESC LIMIT 20`
      )
      .all(req.user!.id, req.user!.role);

    const myLoc = db.prepare('SELECT * FROM driver_locations WHERE driver_id = ?').get(req.user!.id) || null;

    res.json({
      orders: rows.map(hydrateOrder),
      notifications,
      my_location: myLoc,
      store: {
        name: settings.business_name,
        address: settings.address,
        hours: settings.hours,
        lat: settings.store_lat,
        lng: settings.store_lng,
      },
    });
  });

  app.post('/api/orders/:id/start-delivery', requireAuth(['Repartidor', 'Administrador', 'Encargado de pedidos']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de pedido inválido.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Pedido no encontrado.' });
      return;
    }
    if (existing.delivery_mode !== 'domicilio') {
      res.status(400).json({ error: 'Este pedido es para recoger en tienda.' });
      return;
    }
    if (['entregado', 'rechazado', 'cancelado'].includes(existing.status)) {
      res.status(400).json({ error: 'No se puede iniciar entrega en un pedido cerrado.' });
      return;
    }
    if (req.user!.role === 'Repartidor' && existing.assigned_driver_id && existing.assigned_driver_id !== req.user!.id) {
      res.status(403).json({ error: 'Este pedido está asignado a otro repartidor.' });
      return;
    }

    const driverId = existing.assigned_driver_id || req.user!.id;
    const driverRow = db.prepare('SELECT id, name FROM users WHERE id = ?').get(driverId) as any;
    const driverName = driverRow?.name || req.user!.name;

    const settings = getParsedSettings();
    const hasBodyCoords = req.body?.lat !== undefined && req.body?.lng !== undefined;
    if (hasBodyCoords && !isValidCoord(req.body.lat, req.body.lng)) {
      res.status(400).json({ error: 'Coordenadas GPS iniciales inválidas.' });
      return;
    }
    const initLat = hasBodyCoords ? Number(req.body.lat) : settings.store_lat;
    const initLng = hasBodyCoords ? Number(req.body.lng) : settings.store_lng;

    db.transaction(() => {
      db.prepare(
        `UPDATE orders SET
          status = 'en_camino',
          assigned_driver_id = ?,
          assigned_driver_name = ?,
          dispatched_at = COALESCE(dispatched_at, datetime('now', 'localtime')),
          driver_started_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(driverId, driverName, id);

      db.prepare(
        `INSERT INTO driver_locations (driver_id, order_id, lat, lng, heading, speed_kmh, accuracy_m, is_tracking, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, 15, 1, datetime('now', 'localtime'))
         ON CONFLICT(driver_id) DO UPDATE SET
           order_id = excluded.order_id, lat = excluded.lat, lng = excluded.lng,
           is_tracking = 1, updated_at = datetime('now', 'localtime')`
      ).run(driverId, id, initLat, initLng);

      if (existing.status !== 'en_camino') {
        db.prepare(
          `INSERT INTO delivery_notifications (order_id, target_role, target_user_id, event_type, title, message)
           VALUES (?, 'customer', ?, 'order_dispatched', ?, ?)`
        ).run(
          id,
          existing.created_by_user_id || null,
          'Tu pedido salió del establecimiento',
          `El repartidor ${driverName} inició la ruta hacia ${existing.delivery_address}.`
        );
      }
    })();

    const updatedOrder = hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
    broadcastRoom(`order:${existing.order_number}`, { type: 'order:updated', order: updatedOrder });
    broadcastRoom(`order:${existing.order_number}`, {
      type: 'driver:location',
      order_id: id,
      order_number: existing.order_number,
      lat: initLat,
      lng: initLng,
      heading: 0,
      speed_kmh: 0,
      is_tracking: 1,
      updated_at: new Date().toISOString(),
    });
    broadcastRoom('admin', { type: 'order:updated', order: updatedOrder });
    logAudit(req.user!, 'Entregas', 'Inicio de entrega y GPS', `Repartidor ${driverName} inició entrega de ${existing.order_number}.`);
    res.json(updatedOrder);
  });

  app.post('/api/driver/location', requireAuth(['Repartidor', 'Administrador']), (req: AuthedRequest, res: Response) => {
    const { order_id, lat, lng, heading, speed_kmh, accuracy_m } = req.body || {};
    if (!isValidCoord(lat, lng)) {
      res.status(400).json({ error: 'Coordenadas GPS inválidas.' });
      return;
    }
    const numLat = Number(lat);
    const numLng = Number(lng);
    const safeHeading = Math.min(360, Math.max(0, Number(heading || 0) || 0));
    const safeSpeed = Math.min(200, Math.max(0, Number(speed_kmh || 0) || 0));
    const safeAccuracy = Math.min(5000, Math.max(0, Number(accuracy_m || 10) || 10));

    let activeOrder: any = null;
    if (order_id !== undefined && order_id !== null && order_id !== '') {
      const parsedOrderId = parsePositiveInt(order_id);
      if (!parsedOrderId) {
        res.status(400).json({ error: 'ID de pedido inválido.' });
        return;
      }
      activeOrder = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'en_camino'").get(parsedOrderId) as any;
    } else {
      activeOrder = db.prepare("SELECT * FROM orders WHERE assigned_driver_id = ? AND status = 'en_camino' ORDER BY id DESC LIMIT 1").get(req.user!.id) as any;
    }

    if (!activeOrder) {
      db.prepare('UPDATE driver_locations SET is_tracking = 0, order_id = NULL WHERE driver_id = ?').run(req.user!.id);
      res.status(400).json({ error: 'No tienes una entrega activa en curso. El seguimiento GPS solo está permitido durante entregas asignadas en camino.' });
      return;
    }

    if (req.user!.role === 'Repartidor' && activeOrder.assigned_driver_id !== req.user!.id) {
      res.status(403).json({ error: 'Este pedido está asignado a otro repartidor.' });
      return;
    }

    const driverId = activeOrder.assigned_driver_id || req.user!.id;
    db.prepare(
      `INSERT INTO driver_locations (driver_id, order_id, lat, lng, heading, speed_kmh, accuracy_m, is_tracking, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
       ON CONFLICT(driver_id) DO UPDATE SET
         order_id = excluded.order_id,
         lat = excluded.lat,
         lng = excluded.lng,
         heading = excluded.heading,
         speed_kmh = excluded.speed_kmh,
         accuracy_m = excluded.accuracy_m,
         is_tracking = 1,
         updated_at = datetime('now', 'localtime')`
    ).run(driverId, activeOrder.id, numLat, numLng, safeHeading, safeSpeed, safeAccuracy);

    let remainingKm: number | null = null;
    let etaMin: number | null = null;
    let nearTriggered = false;

    if (activeOrder.delivery_lat && activeOrder.delivery_lng) {
      const straightKm = haversineKm(numLat, numLng, activeOrder.delivery_lat, activeOrder.delivery_lng);
      remainingKm = Number((straightKm * 1.2).toFixed(2));
      etaMin = Math.max(1, Math.round((remainingKm / 26) * 60));

      if (straightKm <= 0.4 && !activeOrder.near_notified) {
        nearTriggered = true;
        db.prepare('UPDATE orders SET near_notified = 1 WHERE id = ?').run(activeOrder.id);
        const nRes = db
          .prepare(
            `INSERT INTO delivery_notifications (order_id, target_role, target_user_id, event_type, title, message)
             VALUES (?, 'customer', ?, 'driver_near', ?, ?)`
          )
          .run(
            activeOrder.id,
            activeOrder.created_by_user_id || null,
            '¡Tu repartidor está cerca!',
            `${activeOrder.assigned_driver_name || 'El repartidor'} se encuentra a menos de 400 metros de tu ubicación.`
          );
        const notif = db.prepare('SELECT * FROM delivery_notifications WHERE id = ?').get(Number(nRes.lastInsertRowid));
        broadcastRoom(`order:${activeOrder.order_number}`, { type: 'order:notification', notification: notif });
      }
    }

    const locPayload = {
      type: 'driver:location',
      driver_id: driverId,
      driver_name: activeOrder.assigned_driver_name || req.user!.name,
      order_id: activeOrder.id,
      order_number: activeOrder.order_number,
      lat: numLat,
      lng: numLng,
      heading: safeHeading,
      speed_kmh: safeSpeed,
      accuracy_m: safeAccuracy,
      remaining_km: remainingKm,
      eta_min: etaMin,
      is_tracking: 1,
      updated_at: new Date().toISOString(),
    };

    // Strict isolation: broadcast ONLY to this order's room and admin room
    broadcastRoom(`order:${activeOrder.order_number}`, locPayload);
    broadcastRoom('admin', locPayload);

    res.json({ ok: true, remaining_km: remainingKm, eta_min: etaMin, near_triggered: nearTriggered });
  });

  app.post('/api/driver/stop-tracking', requireAuth(['Repartidor', 'Administrador']), (req: AuthedRequest, res: Response) => {
    const loc = db.prepare('SELECT order_id FROM driver_locations WHERE driver_id = ?').get(req.user!.id) as any;
    db.prepare('UPDATE driver_locations SET is_tracking = 0, order_id = NULL WHERE driver_id = ?').run(req.user!.id);
    if (loc?.order_id) {
      const ord = db.prepare('SELECT id, order_number FROM orders WHERE id = ?').get(loc.order_id) as any;
      if (ord) {
        broadcastRoom(`order:${ord.order_number}`, { type: 'tracking:stopped', order_id: ord.id, order_number: ord.order_number });
      }
    }
    broadcastRoom('admin', { type: 'driver:stopped', driver_id: req.user!.id });
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/confirm-received', (req: Request, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de pedido inválido.' });
      return;
    }
    const authedUser = getUserFromRequest(req);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado.' });
      return;
    }

    const providedToken = cleanText(req.get('x-tracking-token') || req.body?.tracking_token, 128);
    const isOwner = Boolean(authedUser && order.created_by_user_id !== null && order.created_by_user_id === authedUser.id);
    const isStaff = Boolean(authedUser && ['Administrador', 'Encargado de pedidos'].includes(authedUser.role));
    const hasToken = Boolean(providedToken && order.tracking_token && safeTimingEqual(providedToken, String(order.tracking_token)));
    if (!isOwner && !isStaff && !hasToken) {
      res.status(403).json({ error: 'No autorizado para confirmar la recepción de este pedido.' });
      return;
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE orders SET
          status = CASE WHEN status IN ('en_camino', 'listo_recoger', 'en_preparacion', 'confirmado') THEN 'entregado' ELSE status END,
          delivered_at = COALESCE(delivered_at, datetime('now', 'localtime')),
          customer_confirmed_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(id);
      db.prepare('UPDATE driver_locations SET is_tracking = 0, order_id = NULL WHERE order_id = ?').run(id);
    })();

    const updatedOrder = hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
    broadcastRoom(`order:${order.order_number}`, { type: 'order:updated', order: updatedOrder });
    broadcastRoom(`order:${order.order_number}`, { type: 'tracking:stopped', order_id: id, order_number: order.order_number });
    broadcastRoom('admin', { type: 'order:updated', order: updatedOrder });
    logAudit(authedUser || { name: order.customer_name, role: 'Cliente' }, 'Pedidos', 'Confirmación de recepción', `Cliente confirmó recepción del pedido ${order.order_number}.`);
    res.json(updatedOrder);
  });

  app.post('/api/notifications/:id/read', requireAuth(), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de notificación inválido.' });
      return;
    }
    const notif = db
      .prepare(
        `SELECT n.*, o.created_by_user_id
         FROM delivery_notifications n
         LEFT JOIN orders o ON o.id = n.order_id
         WHERE n.id = ?`
      )
      .get(id) as any;
    if (!notif) {
      res.status(404).json({ error: 'Notificación no encontrada.' });
      return;
    }
    const canMark =
      req.user!.role === 'Administrador' ||
      notif.target_user_id === req.user!.id ||
      (notif.target_role === 'customer' && notif.created_by_user_id === req.user!.id);
    if (!canMark) {
      res.status(403).json({ error: 'No autorizado para modificar esta notificación.' });
      return;
    }
    db.prepare('UPDATE delivery_notifications SET is_read = 1 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  app.get('/api/admin/deliveries', requireAuth(['Administrador', 'Encargado de pedidos']), (_req: Request, res: Response) => {
    const settings = getParsedSettings();
    const orders = db
      .prepare("SELECT * FROM orders WHERE channel = 'online' AND delivery_mode = 'domicilio' ORDER BY id DESC")
      .all()
      .map((o: any) => {
        const hydrated = hydrateOrder(o);
        const createdMs = new Date(String(o.created_at).replace(' ', 'T')).getTime();
        const elapsedMin = Number.isFinite(createdMs) ? Math.max(0, Math.round((Date.now() - createdMs) / 60000)) : 0;
        const isActive = !['entregado', 'rechazado', 'cancelado'].includes(o.status);
        const isDelayed = isActive && elapsedMin > 40;
        return { ...hydrated, elapsed_min: elapsedMin, is_delayed: isDelayed };
      });

    const activeDrivers = db
      .prepare(
        `SELECT dl.*, u.name as driver_name, u.phone as driver_phone, o.order_number
         FROM driver_locations dl
         JOIN users u ON u.id = dl.driver_id
         LEFT JOIN orders o ON o.id = dl.order_id
         WHERE dl.is_tracking = 1 AND o.status = 'en_camino'`
      )
      .all();

    const drivers = db
      .prepare("SELECT id, name, phone, email, is_active FROM users WHERE role = 'Repartidor' AND is_active = 1 ORDER BY name ASC")
      .all();

    res.json({
      orders,
      active_drivers: activeDrivers,
      drivers,
      store: {
        name: settings.business_name,
        address: settings.address,
        hours: settings.hours,
        lat: settings.store_lat,
        lng: settings.store_lng,
      },
    });
  });

  // --- RECEIPTS / COMPROBANTES ---
  app.get('/api/invoices', requireAuth(), (req: AuthedRequest, res: Response) => {
    let rows: any[];
    if (req.user!.role === 'Cliente') {
      rows = db
        .prepare(
          `SELECT i.*, o.order_number, o.channel
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           WHERE o.created_by_user_id = ?
           ORDER BY i.id DESC`
        )
        .all(req.user!.id);
    } else {
      rows = db
        .prepare(
          `SELECT i.*, o.order_number, o.channel
           FROM invoices i
           JOIN orders o ON o.id = i.order_id
           ORDER BY i.id DESC`
        )
        .all();
    }
    const hydrated = rows.map((inv) => ({
      ...inv,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(inv.order_id),
    }));
    res.json(hydrated);
  });

  app.post('/api/invoices/generate/:orderId', requireAuth(['Administrador', 'Cajero', 'Encargado de pedidos']), (req: AuthedRequest, res: Response) => {
    const orderId = parsePositiveInt(req.params.orderId);
    if (!orderId) {
      res.status(400).json({ error: 'ID de pedido inválido.' });
      return;
    }
    try {
      const inv = generateInvoiceForOrder(orderId, req.user!.name);
      const full = {
        ...inv,
        items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(inv.order_id),
      };
      logAudit(req.user!, 'Comprobantes', 'Emisión de comprobante', `Comprobante ${inv.invoice_number} emitido.`);
      res.json(full);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/invoices/:id/void', requireAuth(['Administrador', 'Cajero']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de comprobante inválido.' });
      return;
    }
    const reason = cleanText(req.body?.reason, 250);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    if (!inv) {
      res.status(404).json({ error: 'Comprobante no encontrado.' });
      return;
    }
    if (inv.status === 'anulada') {
      res.status(400).json({ error: 'Este comprobante ya fue anulado.' });
      return;
    }
    const creditNoteNumber = `NC-${inv.invoice_number.slice(-8)}`;
    db.prepare(
      `UPDATE invoices SET status = 'anulada', credit_note_number = ?, void_reason = ?, voided_by = ?, voided_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(creditNoteNumber, reason || 'Anulación solicitada', req.user!.name, id);

    logAudit(req.user!, 'Comprobantes', 'Anulación y Nota de Crédito', `Comprobante ${inv.invoice_number} anulado con Nota de Crédito ${creditNoteNumber}. Motivo: ${reason || 'N/A'}`);
    res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
  });

  // --- CASH DRAWER (CONTROL DE CAJA) ---
  function computeSessionSummary(session: any) {
    if (!session) return null;
    const endTime = session.closed_at || '9999-12-31 23:59:59';
    const salesRow = db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END), 0) as cash_sales,
          COALESCE(SUM(CASE WHEN payment_method = 'transferencia' THEN total ELSE 0 END), 0) as transfer_sales
         FROM orders
         WHERE channel = 'pos' AND status != 'cancelado' AND created_at >= ? AND created_at <= ?`
      )
      .get(session.opened_at, endTime) as any;

    const movRow = db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END), 0) as entries,
          COALESCE(SUM(CASE WHEN type = 'salida' THEN amount ELSE 0 END), 0) as withdrawals,
          COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount ELSE 0 END), 0) as expenses
         FROM cash_movements
         WHERE session_id = ?`
      )
      .get(session.id) as any;

    const expectedCash = Number(
      (session.opening_amount + salesRow.cash_sales + movRow.entries - movRow.withdrawals - movRow.expenses).toFixed(2)
    );

    return {
      ...session,
      cash_sales_total: Number(salesRow.cash_sales.toFixed(2)),
      transfer_sales_total: Number(salesRow.transfer_sales.toFixed(2)),
      entries_total: Number(movRow.entries.toFixed(2)),
      withdrawals_total: Number(movRow.withdrawals.toFixed(2)),
      expenses_total: Number(movRow.expenses.toFixed(2)),
      expected_cash: session.status === 'cerrada' && session.expected_cash !== null ? session.expected_cash : expectedCash,
    };
  }

  app.get('/api/cash/current', requireAuth(['Administrador', 'Cajero']), (_req: Request, res: Response) => {
    const open = db.prepare("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY id DESC LIMIT 1").get() as any;
    const movements = open ? db.prepare('SELECT * FROM cash_movements WHERE session_id = ? ORDER BY id DESC').all(open.id) : [];
    res.json({ session: computeSessionSummary(open), movements });
  });

  app.get('/api/cash/history', requireAuth(['Administrador', 'Cajero']), (_req: Request, res: Response) => {
    const rows = db.prepare('SELECT * FROM cash_sessions ORDER BY id DESC LIMIT 40').all() as any[];
    res.json(rows.map(computeSessionSummary));
  });

  app.post('/api/cash/open', requireAuth(['Administrador', 'Cajero']), (req: AuthedRequest, res: Response) => {
    const open = db.prepare("SELECT id FROM cash_sessions WHERE status = 'abierta'").get();
    if (open) {
      res.status(400).json({ error: 'Ya existe una caja abierta.' });
      return;
    }
    const openingAmount = parseNonNegativeNumber(req.body?.opening_amount ?? 0);
    if (openingAmount === null) {
      res.status(400).json({ error: 'El monto de apertura debe ser un número mayor o igual a cero.' });
      return;
    }
    const result = db
      .prepare('INSERT INTO cash_sessions (opened_by_id, opened_by_name, opening_amount, status) VALUES (?, ?, ?, ?)')
      .run(req.user!.id, req.user!.name, openingAmount, 'abierta');

    logAudit(req.user!, 'Control de caja', 'Apertura de caja', `Caja abierta con efectivo inicial de L. ${openingAmount.toFixed(2)}.`);
    const session = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(Number(result.lastInsertRowid));
    res.json({ session: computeSessionSummary(session), movements: [] });
  });

  app.post('/api/cash/movement', requireAuth(['Administrador', 'Cajero']), (req: AuthedRequest, res: Response) => {
    const open = db.prepare("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY id DESC LIMIT 1").get() as any;
    if (!open) {
      res.status(400).json({ error: 'No hay caja abierta.' });
      return;
    }
    const { type, amount, concept } = req.body || {};
    const numAmount = parseNonNegativeNumber(amount);
    const cleanConcept = cleanText(concept, 200);
    if (!['entrada', 'salida', 'gasto'].includes(type) || numAmount === null || numAmount <= 0 || !cleanConcept) {
      res.status(400).json({ error: 'Tipo válido, monto mayor a cero y concepto son requeridos.' });
      return;
    }
    db.prepare('INSERT INTO cash_movements (session_id, type, amount, concept, user_name) VALUES (?, ?, ?, ?, ?)').run(
      open.id,
      type,
      Number(numAmount.toFixed(2)),
      cleanConcept,
      req.user!.name
    );
    logAudit(req.user!, 'Control de caja', `Movimiento (${type})`, `L. ${numAmount.toFixed(2)} - ${cleanConcept}`);
    res.json({ ok: true });
  });

  app.post('/api/cash/close', requireAuth(['Administrador', 'Cajero']), (req: AuthedRequest, res: Response) => {
    const open = db.prepare("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY id DESC LIMIT 1").get() as any;
    if (!open) {
      res.status(400).json({ error: 'No hay caja abierta para cerrar.' });
      return;
    }
    const countedCash = parseNonNegativeNumber(req.body?.counted_cash ?? 0);
    if (countedCash === null) {
      res.status(400).json({ error: 'El efectivo contado debe ser un número mayor o igual a cero.' });
      return;
    }
    const summary = computeSessionSummary(open)!;
    const difference = Number((countedCash - summary.expected_cash).toFixed(2));
    const notes = cleanText(req.body?.notes, 300);

    db.prepare(
      `UPDATE cash_sessions SET
        closed_by_id = ?, closed_by_name = ?, closed_at = datetime('now', 'localtime'),
        counted_cash = ?, expected_cash = ?, difference = ?, notes = ?, status = 'cerrada'
       WHERE id = ?`
    ).run(req.user!.id, req.user!.name, countedCash, summary.expected_cash, difference, notes, open.id);

    logAudit(
      req.user!,
      'Control de caja',
      'Cierre y arqueo de caja',
      `Esperado: L. ${summary.expected_cash.toFixed(2)}, Contado: L. ${countedCash.toFixed(2)}, Diferencia: L. ${difference.toFixed(2)}.`
    );
    res.json(computeSessionSummary(db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(open.id)));
  });

  // --- INVENTORY ---
  app.get('/api/inventory/movements', requireAuth(['Administrador', 'Encargado de inventario', 'Cajero']), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT m.*, p.name as product_name, p.internal_code
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         ORDER BY m.id DESC LIMIT 200`
      )
      .all();
    res.json(rows);
  });

  app.post('/api/inventory/adjust', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const { product_id, type, quantity, reason, batch_expiry } = req.body || {};
    const productId = parsePositiveInt(product_id);
    if (!productId) {
      res.status(400).json({ error: 'ID de producto inválido.' });
      return;
    }
    if (!['entrada', 'salida', 'ajuste', 'perdida_danado'].includes(type)) {
      res.status(400).json({ error: 'Tipo de movimiento inválido.' });
      return;
    }
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!prod) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty === 0) {
      res.status(400).json({ error: 'La cantidad debe ser un número entero distinto de cero.' });
      return;
    }
    if (type !== 'ajuste' && qty < 1) {
      res.status(400).json({ error: 'La cantidad debe ser un entero positivo.' });
      return;
    }

    let delta = qty;
    if (type === 'salida' || type === 'perdida_danado') {
      delta = -Math.abs(qty);
    } else if (type === 'entrada') {
      delta = Math.abs(qty);
    }

    const newStock = Math.max(0, prod.stock + delta);
    const cleanReason = cleanText(reason, 250);
    const cleanExpiry = cleanText(batch_expiry, 20) || null;

    db.transaction(() => {
      db.prepare("UPDATE products SET stock = ?, expiry_date = COALESCE(?, expiry_date), updated_at = datetime('now', 'localtime') WHERE id = ?").run(
        newStock,
        cleanExpiry,
        prod.id
      );
      db.prepare(
        `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, batch_expiry, user_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(prod.id, type, newStock - prod.stock, prod.stock, newStock, cleanReason || 'Movimiento manual', cleanExpiry, req.user!.name);
    })();

    logAudit(req.user!, 'Inventario', `Movimiento (${type})`, `${prod.name}: ${prod.stock} -> ${newStock} (${cleanReason || 'Sin motivo'})`);
    res.json({ ok: true, new_stock: newStock });
  });

  app.post('/api/inventory/physical-count', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const counts = Array.isArray(req.body?.counts) ? req.body.counts : [];
    if (counts.length === 0) {
      res.status(400).json({ error: 'No se recibieron conteos para aplicar.' });
      return;
    }
    let adjusted = 0;

    try {
      db.transaction(() => {
        for (const c of counts) {
          const productId = parsePositiveInt(c?.product_id);
          if (!productId) continue;
          const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
          if (!prod) continue;
          const physical = Number(c?.counted_stock);
          if (!Number.isFinite(physical) || !Number.isInteger(physical) || physical < 0) {
            throw new Error(`El conteo físico para ${prod.name} debe ser un número entero mayor o igual a cero.`);
          }
          if (physical !== prod.stock) {
            const delta = physical - prod.stock;
            db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(physical, prod.id);
            db.prepare(
              `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, user_name)
               VALUES (?, 'conteo_fisico', ?, ?, ?, ?, ?)`
            ).run(prod.id, delta, prod.stock, physical, cleanText(c?.notes, 200) || 'Conteo físico de inventario', req.user!.name);
            adjusted++;
          }
        }
      })();
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Error al aplicar el conteo físico.' });
      return;
    }

    logAudit(req.user!, 'Inventario', 'Conteo físico aplicado', `Se ajustaron ${adjusted} productos tras conteo físico.`);
    res.json({ ok: true, adjusted });
  });

  // --- CUSTOMERS ---
  app.get('/api/customers', requireAuth(['Administrador', 'Cajero', 'Encargado de pedidos']), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelado' AND o.status != 'rechazado') as orders_count,
          (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelado' AND o.status != 'rechazado') as total_spent
         FROM customers c
         ORDER BY c.id DESC`
      )
      .all() as any[];
    res.json(
      rows.map((r) => ({
        ...r,
        addresses: JSON.parse(r.addresses || '[]'),
      }))
    );
  });

  app.get('/api/customers/my-account', requireAuth(), (req: AuthedRequest, res: Response) => {
    let customer = db.prepare('SELECT * FROM customers WHERE user_id = ?').get(req.user!.id) as any;
    if (!customer) {
      const cRes = db
        .prepare('INSERT INTO customers (name, phone, email, rtn, razon_social, addresses, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.user!.name, req.user!.phone, req.user!.email, '', req.user!.name, '[]', req.user!.id);
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(cRes.lastInsertRowid));
    }
    const orders = db
      .prepare('SELECT * FROM orders WHERE created_by_user_id = ? OR customer_id = ? ORDER BY id DESC')
      .all(req.user!.id, customer.id)
      .map(hydrateOrder);

    const invoices = db
      .prepare(
        `SELECT i.*, o.order_number FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE o.created_by_user_id = ? OR o.customer_id = ?
         ORDER BY i.id DESC`
      )
      .all(req.user!.id, customer.id)
      .map((inv: any) => ({ ...inv, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(inv.order_id) }));

    res.json({
      customer: { ...customer, addresses: JSON.parse(customer.addresses || '[]') },
      orders,
      invoices,
    });
  });

  app.put('/api/customers/my-account', requireAuth(), (req: AuthedRequest, res: Response) => {
    const { name, phone, rtn, razon_social, addresses } = req.body || {};
    const cleanName = cleanText(name, 120);
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres.' });
      return;
    }
    const cleanPhone = cleanText(phone, 40);
    const cleanRtn = cleanText(rtn, 30);
    const cleanRazon = cleanText(razon_social, 140) || cleanName;
    const safeAddresses = Array.isArray(addresses) ? addresses.slice(0, 15) : [];

    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(cleanName, cleanPhone, req.user!.id);
    db.prepare('UPDATE customers SET name = ?, phone = ?, rtn = ?, razon_social = ?, addresses = ? WHERE user_id = ?').run(
      cleanName,
      cleanPhone,
      cleanRtn,
      cleanRazon,
      JSON.stringify(safeAddresses),
      req.user!.id
    );
    res.json({ ok: true });
  });

  app.post('/api/customers', requireAuth(['Administrador', 'Cajero', 'Encargado de pedidos']), (req: AuthedRequest, res: Response) => {
    const c = req.body || {};
    const cleanName = cleanText(c.name, 120);
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
      return;
    }
    const cleanEmail = cleanText(c.email, 160);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      res.status(400).json({ error: 'Correo electrónico inválido.' });
      return;
    }
    const safeAddresses = Array.isArray(c.addresses) ? c.addresses.slice(0, 15) : [];
    const result = db
      .prepare('INSERT INTO customers (name, phone, email, rtn, razon_social, addresses, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        cleanName,
        cleanText(c.phone, 40),
        cleanEmail,
        cleanText(c.rtn, 30),
        cleanText(c.razon_social, 140) || cleanName,
        JSON.stringify(safeAddresses),
        cleanText(c.notes, 300)
      );
    logAudit(req.user!, 'Clientes', 'Nuevo cliente', `Cliente ${cleanName} registrado.`);
    const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(result.lastInsertRowid)) as any;
    res.json({ ...created, addresses: JSON.parse(created.addresses || '[]') });
  });

  app.put('/api/customers/:id', requireAuth(['Administrador', 'Cajero', 'Encargado de pedidos']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de cliente inválido.' });
      return;
    }
    const c = req.body || {};
    const cleanName = cleanText(c.name, 120);
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
      return;
    }
    const cleanEmail = cleanText(c.email, 160);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      res.status(400).json({ error: 'Correo electrónico inválido.' });
      return;
    }
    const safeAddresses = Array.isArray(c.addresses) ? c.addresses.slice(0, 15) : [];
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ?, rtn = ?, razon_social = ?, addresses = ?, notes = ? WHERE id = ?').run(
      cleanName,
      cleanText(c.phone, 40),
      cleanEmail,
      cleanText(c.rtn, 30),
      cleanText(c.razon_social, 140) || cleanName,
      JSON.stringify(safeAddresses),
      cleanText(c.notes, 300),
      id
    );
    logAudit(req.user!, 'Clientes', 'Edición de cliente', `Cliente #${id} (${cleanName}) actualizado.`);
    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!updated) {
      res.status(404).json({ error: 'Cliente no encontrado.' });
      return;
    }
    res.json({ ...updated, addresses: JSON.parse(updated.addresses || '[]') });
  });

  // --- SUPPLIERS & PURCHASES ---
  app.get('/api/suppliers', requireAuth(['Administrador', 'Encargado de inventario']), (_req: Request, res: Response) => {
    res.json(db.prepare('SELECT * FROM suppliers ORDER BY id DESC').all());
  });

  app.post('/api/suppliers', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const s = req.body || {};
    const cleanName = cleanText(s.name, 140);
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'El nombre del proveedor es obligatorio.' });
      return;
    }
    const cleanEmail = cleanText(s.email, 160);
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      res.status(400).json({ error: 'Correo del proveedor inválido.' });
      return;
    }
    const result = db
      .prepare('INSERT INTO suppliers (name, rtn, contact_name, phone, email, products_supplied, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        cleanName,
        cleanText(s.rtn, 30),
        cleanText(s.contact_name, 120),
        cleanText(s.phone, 40),
        cleanEmail,
        cleanText(s.products_supplied, 300),
        cleanText(s.notes, 300)
      );
    logAudit(req.user!, 'Proveedores', 'Nuevo proveedor', `Proveedor ${cleanName} registrado.`);
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(result.lastInsertRowid)));
  });

  app.get('/api/purchases', requireAuth(['Administrador', 'Encargado de inventario']), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT p.*, s.name as supplier_name
         FROM purchases p
         JOIN suppliers s ON s.id = p.supplier_id
         ORDER BY p.id DESC`
      )
      .all() as any[];
    res.json(
      rows.map((p) => ({
        ...p,
        items: db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(p.id),
      }))
    );
  });

  app.post('/api/purchases', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const supplierId = parsePositiveInt(body.supplier_id);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!supplierId || items.length === 0) {
      res.status(400).json({ error: 'Seleccione proveedor y agregue productos válidos.' });
      return;
    }
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId)) {
      res.status(404).json({ error: 'Proveedor no encontrado.' });
      return;
    }

    try {
      const purchase = db.transaction(() => {
        const validatedItems: Array<{ prod: any; qty: number; unitCost: number; batchExpiry: string | null }> = [];
        let totalCost = 0;

        for (const it of items) {
          const prodId = parsePositiveInt(it?.product_id);
          const qty = parsePositiveInt(it?.quantity);
          const unitCost = parseNonNegativeNumber(it?.unit_cost);
          if (!prodId || !qty || unitCost === null) {
            throw new Error('Cada línea de compra debe tener producto válido, cantidad entera positiva y costo no negativo.');
          }
          const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId) as any;
          if (!prod) {
            throw new Error(`Producto #${prodId} no encontrado.`);
          }
          totalCost += qty * unitCost;
          validatedItems.push({
            prod,
            qty,
            unitCost: Number(unitCost.toFixed(2)),
            batchExpiry: cleanText(it?.batch_expiry, 20) || null,
          });
        }

        const status = body.confirm_immediately ? 'confirmada' : 'pendiente';
        const docNumber = cleanText(body.document_number, 60) || `COMP-${Date.now()}`;
        const purchaseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.purchase_date || ''))
          ? String(body.purchase_date)
          : new Date().toISOString().slice(0, 10);

        const pRes = db
          .prepare(
            `INSERT INTO purchases (supplier_id, document_number, purchase_date, total_cost, status, notes, created_by, confirmed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            supplierId,
            docNumber,
            purchaseDate,
            Number(totalCost.toFixed(2)),
            status,
            cleanText(body.notes, 300),
            req.user!.name,
            status === 'confirmada' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
          );

        const purchaseId = Number(pRes.lastInsertRowid);
        for (const item of validatedItems) {
          const { prod, qty, unitCost, batchExpiry } = item;
          db.prepare(
            `INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, line_total, batch_expiry)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(purchaseId, prod.id, prod.name, qty, unitCost, Number((qty * unitCost).toFixed(2)), batchExpiry);

          if (status === 'confirmada') {
            const currentProd = db.prepare('SELECT stock, purchase_price, sale_price FROM products WHERE id = ?').get(prod.id) as any;
            const newStock = currentProd.stock + qty;
            if (unitCost !== currentProd.purchase_price) {
              db.prepare(
                `INSERT INTO price_history (product_id, old_purchase_price, new_purchase_price, old_sale_price, new_sale_price, changed_by)
                 VALUES (?, ?, ?, ?, ?, ?)`
              ).run(prod.id, currentProd.purchase_price, unitCost, currentProd.sale_price, currentProd.sale_price, req.user!.name);
            }
            db.prepare(
              `UPDATE products SET stock = ?, purchase_price = ?, expiry_date = COALESCE(?, expiry_date), updated_at = datetime('now', 'localtime') WHERE id = ?`
            ).run(newStock, unitCost, batchExpiry, prod.id);
            db.prepare(
              `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, batch_expiry, user_name)
               VALUES (?, 'compra', ?, ?, ?, ?, ?, ?)`
            ).run(prod.id, qty, currentProd.stock, newStock, `Compra ${docNumber}`, batchExpiry, req.user!.name);
          }
        }

        logAudit(req.user!, 'Compras', status === 'confirmada' ? 'Compra confirmada' : 'Compra registrada', `Documento ${docNumber} por L. ${totalCost.toFixed(2)}.`);
        return db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
      })();

      res.json(purchase);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'No se pudo registrar la compra.' });
    }
  });

  app.post('/api/purchases/:id/confirm', requireAuth(['Administrador', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de compra inválido.' });
      return;
    }
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as any;
    if (!purchase || purchase.status === 'confirmada') {
      res.status(400).json({ error: 'Compra no encontrada o ya confirmada.' });
      return;
    }

    db.transaction(() => {
      const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(id) as any[];
      for (const it of items) {
        const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id) as any;
        if (!prod) continue;
        const newStock = prod.stock + it.quantity;
        db.prepare(
          `UPDATE products SET stock = ?, purchase_price = ?, expiry_date = COALESCE(?, expiry_date), updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(newStock, it.unit_cost, it.batch_expiry || null, prod.id);
        db.prepare(
          `INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, batch_expiry, user_name)
           VALUES (?, 'compra', ?, ?, ?, ?, ?, ?)`
        ).run(prod.id, it.quantity, prod.stock, newStock, `Compra confirmada ${purchase.document_number}`, it.batch_expiry || null, req.user!.name);
      }
      db.prepare("UPDATE purchases SET status = 'confirmada', confirmed_at = datetime('now', 'localtime') WHERE id = ?").run(id);
    })();

    logAudit(req.user!, 'Compras', 'Confirmación de compra', `Compra ${purchase.document_number} confirmada e inventario actualizado.`);
    res.json({ ok: true });
  });

  // --- DASHBOARD & REPORTS ---
  app.get('/api/dashboard', requireAuth(['Administrador', 'Cajero', 'Encargado de pedidos', 'Encargado de inventario']), (req: AuthedRequest, res: Response) => {
    const todaySales = (
      db
        .prepare(
          `SELECT COALESCE(SUM(total), 0) as v FROM orders
           WHERE date(created_at) = date('now', 'localtime') AND status NOT IN ('cancelado', 'rechazado')`
        )
        .get() as any
    ).v;
    const monthSales = (
      db
        .prepare(
          `SELECT COALESCE(SUM(total), 0) as v FROM orders
           WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') AND status NOT IN ('cancelado', 'rechazado')`
        )
        .get() as any
    ).v;

    const pendingOrders = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE channel = 'online' AND status = 'recibido'").get() as any).c;
    const prepOrders = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE channel = 'online' AND status IN ('confirmado', 'en_preparacion')").get() as any).c;
    const deliveryOrders = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE channel = 'online' AND status IN ('listo_recoger', 'en_camino')").get() as any).c;

    const totalProducts = (db.prepare('SELECT COUNT(*) as c FROM products WHERE is_active = 1').get() as any).c;
    const lowStockProducts = db
      .prepare('SELECT * FROM products WHERE is_active = 1 AND stock > 0 AND stock <= min_stock')
      .all()
      .map((p) => sanitizeProductForUser(p, req.user));
    const outOfStockProducts = db
      .prepare('SELECT * FROM products WHERE is_active = 1 AND stock <= 0')
      .all()
      .map((p) => sanitizeProductForUser(p, req.user));
    const expiringProducts = db
      .prepare(
        `SELECT * FROM products
         WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date != ''
           AND date(expiry_date) <= date('now', 'localtime', '+30 days')`
      )
      .all()
      .map((p) => sanitizeProductForUser(p, req.user));

    const latestSales = db
      .prepare("SELECT * FROM orders WHERE status NOT IN ('cancelado', 'rechazado') ORDER BY id DESC LIMIT 6")
      .all()
      .map(sanitizeOrderForResponse);
    const latestOnlineOrders = db
      .prepare("SELECT * FROM orders WHERE channel = 'online' ORDER BY id DESC LIMIT 6")
      .all()
      .map(sanitizeOrderForResponse);

    const salesByDay = db
      .prepare(
        `SELECT date(created_at) as day,
          COALESCE(SUM(CASE WHEN channel = 'pos' THEN total ELSE 0 END), 0) as pos_total,
          COALESCE(SUM(CASE WHEN channel = 'online' THEN total ELSE 0 END), 0) as online_total
         FROM orders
         WHERE status NOT IN ('cancelado', 'rechazado') AND date(created_at) >= date('now', 'localtime', '-6 days')
         GROUP BY date(created_at)
         ORDER BY day ASC`
      )
      .all();

    res.json({
      kpis: {
        today_sales: Number(todaySales.toFixed(2)),
        month_sales: Number(monthSales.toFixed(2)),
        pending_orders: pendingOrders,
        prep_orders: prepOrders,
        delivery_orders: deliveryOrders,
        total_products: totalProducts,
        low_stock_count: lowStockProducts.length,
        out_of_stock_count: outOfStockProducts.length,
        expiring_count: expiringProducts.length,
      },
      low_stock_products: lowStockProducts,
      out_of_stock_products: outOfStockProducts,
      expiring_products: expiringProducts,
      latest_sales: latestSales,
      latest_online_orders: latestOnlineOrders,
      sales_by_day: salesByDay,
    });
  });

  app.get('/api/reports', requireAuth(['Administrador', 'Cajero']), (req: Request, res: Response) => {
    const startRaw = String(req.query.start || '');
    const endRaw = String(req.query.end || '');
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : '2020-01-01';
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : '2099-12-31';

    const validOrders = db
      .prepare(
        `SELECT * FROM orders
         WHERE date(created_at) >= ? AND date(created_at) <= ? AND status NOT IN ('cancelado', 'rechazado')
         ORDER BY id DESC`
      )
      .all(startDate, endDate) as any[];

    const cancelledOrders = db
      .prepare(
        `SELECT * FROM orders
         WHERE date(created_at) >= ? AND date(created_at) <= ? AND status IN ('cancelado', 'rechazado')
         ORDER BY id DESC`
      )
      .all(startDate, endDate);

    const productPerformance = db
      .prepare(
        `SELECT p.id, p.internal_code, p.name, p.category, p.purchase_price, p.sale_price,
          COALESCE(SUM(oi.quantity), 0) as units_sold,
          COALESCE(SUM(oi.line_total), 0) as revenue,
          COALESCE(SUM(oi.quantity * p.purchase_price), 0) as estimated_cost
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON o.id = oi.order_id AND date(o.created_at) >= ? AND date(o.created_at) <= ? AND o.status NOT IN ('cancelado', 'rechazado')
         GROUP BY p.id
         ORDER BY units_sold DESC`
      )
      .all(startDate, endDate)
      .map((r: any) => ({
        ...r,
        estimated_profit: Number((r.revenue - r.estimated_cost).toFixed(2)),
      }));

    const expenses = db
      .prepare("SELECT * FROM cash_movements WHERE type = 'gasto' AND date(created_at) >= ? AND date(created_at) <= ? ORDER BY id DESC")
      .all(startDate, endDate);

    const purchases = db
      .prepare(
        `SELECT p.*, s.name as supplier_name FROM purchases p
         JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.purchase_date >= ? AND p.purchase_date <= ? ORDER BY p.id DESC`
      )
      .all(startDate, endDate);

    const cashDiffs = db
      .prepare("SELECT * FROM cash_sessions WHERE status = 'cerrada' AND date(opened_at) >= ? AND date(opened_at) <= ? ORDER BY id DESC")
      .all(startDate, endDate);

    const dailySeries = db
      .prepare(
        `SELECT date(created_at) as period,
          COUNT(*) as orders_count,
          SUM(CASE WHEN channel = 'pos' THEN total ELSE 0 END) as pos_sales,
          SUM(CASE WHEN channel = 'online' THEN total ELSE 0 END) as online_sales,
          SUM(total) as total_sales
         FROM orders
         WHERE date(created_at) >= ? AND date(created_at) <= ? AND status NOT IN ('cancelado', 'rechazado')
         GROUP BY date(created_at) ORDER BY period DESC`
      )
      .all(startDate, endDate);

    const weeklySeries = db
      .prepare(
        `SELECT strftime('%Y-W%W', created_at) as period,
          COUNT(*) as orders_count,
          SUM(CASE WHEN channel = 'pos' THEN total ELSE 0 END) as pos_sales,
          SUM(CASE WHEN channel = 'online' THEN total ELSE 0 END) as online_sales,
          SUM(total) as total_sales
         FROM orders
         WHERE date(created_at) >= ? AND date(created_at) <= ? AND status NOT IN ('cancelado', 'rechazado')
         GROUP BY strftime('%Y-W%W', created_at) ORDER BY period DESC`
      )
      .all(startDate, endDate);

    const monthlySeries = db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) as period,
          COUNT(*) as orders_count,
          SUM(CASE WHEN channel = 'pos' THEN total ELSE 0 END) as pos_sales,
          SUM(CASE WHEN channel = 'online' THEN total ELSE 0 END) as online_sales,
          SUM(total) as total_sales
         FROM orders
         WHERE date(created_at) >= ? AND date(created_at) <= ? AND status NOT IN ('cancelado', 'rechazado')
         GROUP BY strftime('%Y-%m', created_at) ORDER BY period DESC`
      )
      .all(startDate, endDate);

    const paymentBreakdown = db
      .prepare(
        `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
         FROM orders
         WHERE date(created_at) >= ? AND date(created_at) <= ? AND status NOT IN ('cancelado', 'rechazado')
         GROUP BY payment_method`
      )
      .all(startDate, endDate);

    res.json({
      valid_orders: validOrders,
      cancelled_orders: cancelledOrders,
      product_performance: productPerformance,
      expenses,
      purchases,
      cash_diffs: cashDiffs,
      daily_series: dailySeries,
      weekly_series: weeklySeries,
      monthly_series: monthlySeries,
      payment_breakdown: paymentBreakdown,
    });
  });

  // --- USERS, RBAC & AUDIT ---
  app.get('/api/users', requireAuth(['Administrador', 'Encargado de pedidos']), (req: AuthedRequest, res: Response) => {
    if (req.user!.role === 'Encargado de pedidos') {
      res.json(db.prepare("SELECT id, name, email, phone, role, is_active, created_at FROM users WHERE role = 'Repartidor'").all());
      return;
    }
    res.json(db.prepare('SELECT id, name, email, phone, role, is_active, created_at FROM users ORDER BY id ASC').all());
  });

  app.post('/api/users', requireAuth(['Administrador']), (req: AuthedRequest, res: Response) => {
    const { name, email, phone, password, role } = req.body || {};
    const cleanName = cleanText(name, 120);
    const cleanEmail = cleanText(email, 160).toLowerCase();
    const cleanPhone = cleanText(phone, 40);
    const rawPassword = typeof password === 'string' ? password : '';

    if (cleanName.length < 2 || !cleanEmail || !rawPassword || !role) {
      res.status(400).json({ error: 'Complete todos los campos requeridos.' });
      return;
    }
    if (!isValidEmail(cleanEmail)) {
      res.status(400).json({ error: 'Ingrese un correo electrónico válido.' });
      return;
    }
    if (!(ALLOWED_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: 'Rol de usuario inválido.' });
      return;
    }
    if (rawPassword.length < 8 || rawPassword.length > 128) {
      res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
      return;
    }
    try {
      const hash = bcrypt.hashSync(rawPassword, 10);
      const uRes = db
        .prepare('INSERT INTO users (name, email, phone, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)')
        .run(cleanName, cleanEmail, cleanPhone, hash, role);
      logAudit(req.user!, 'Usuarios', 'Creación de usuario', `Usuario ${cleanName} (${role}) creado.`);
      res.json(db.prepare('SELECT id, name, email, phone, role, is_active, created_at FROM users WHERE id = ?').get(Number(uRes.lastInsertRowid)));
    } catch {
      res.status(400).json({ error: 'El correo ya existe.' });
    }
  });

  app.put('/api/users/:id', requireAuth(['Administrador']), (req: AuthedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID de usuario inválido.' });
      return;
    }
    const { name, phone, role, is_active, password } = req.body || {};
    const cleanName = cleanText(name, 120);
    if (cleanName.length < 2 || !(ALLOWED_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: 'Nombre válido y rol permitido son obligatorios.' });
      return;
    }
    const rawPassword = typeof password === 'string' ? password.trim() : '';
    if (rawPassword && (rawPassword.length < 8 || rawPassword.length > 128)) {
      res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 128 caracteres.' });
      return;
    }
    db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, is_active = ? WHERE id = ?').run(
      cleanName,
      cleanText(phone, 40),
      role,
      is_active ? 1 : 0,
      id
    );
    if (rawPassword) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(rawPassword, 10), id);
    }
    logAudit(req.user!, 'Usuarios', 'Actualización de usuario', `Usuario #${id} (${cleanName}) actualizado.`);
    res.json(db.prepare('SELECT id, name, email, phone, role, is_active, created_at FROM users WHERE id = ?').get(id));
  });

  app.get('/api/audit-logs', requireAuth(['Administrador']), (_req: Request, res: Response) => {
    res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all());
  });

  // --- BACKUPS ---
  app.get('/api/backup/export', requireAuth(['Administrador']), (req: AuthedRequest, res: Response) => {
    const tables = [
      'business_settings',
      'users',
      'products',
      'price_history',
      'promotions',
      'customers',
      'orders',
      'order_items',
      'invoices',
      'cash_sessions',
      'cash_movements',
      'inventory_movements',
      'suppliers',
      'purchases',
      'purchase_items',
      'audit_logs',
    ];
    const snapshot: Record<string, any[]> = {};
    for (const t of tables) {
      if (t === 'users') {
        snapshot[t] = db.prepare('SELECT id, name, email, phone, role, is_active, created_at FROM users').all();
      } else if (t === 'orders') {
        snapshot[t] = db.prepare('SELECT * FROM orders').all().map(sanitizeOrderForResponse);
      } else {
        snapshot[t] = db.prepare(`SELECT * FROM ${t}`).all();
      }
    }
    logAudit(req.user!, 'Respaldos', 'Copia de seguridad generada', 'Exportación completa de base de datos centralizada.');
    res.json({
      exported_at: new Date().toISOString(),
      system: 'Los Patrones Mini Market',
      snapshot,
    });
  });

  // --- AI GUIDED ASSISTANT (GEMINI SERVER-SIDE) ---
  app.post('/api/assistant/chat', async (req: Request, res: Response) => {
    const authedUser = getUserFromRequest(req);
    const rate = checkAssistantRate(authedUser ? `u:${authedUser.id}` : `ip:${getClientIp(req)}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Demasiadas consultas seguidas al asistente. Intente en un minuto.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'El asistente con IA requiere configurar GEMINI_API_KEY en Settings > Secrets.',
      });
      return;
    }

    const { message, history = [], context = {} } = req.body || {};
    const cleanMsg = cleanText(message, 800);
    if (!cleanMsg) {
      res.status(400).json({ error: 'Escriba su pregunta para el asistente.' });
      return;
    }

    const settings = getParsedSettings();
    const isStaff = Boolean(authedUser && authedUser.role !== 'Cliente');
    const mode = context.mode === 'admin' && isStaff ? 'admin' : 'store';
    const currentScreen = cleanText(context.screen, 50) || (mode === 'admin' ? 'dashboard' : 'inicio');
    const userRole = authedUser?.role || 'Cliente';

    // Ground with relevant active products & promos from SQLite
    const keywords = cleanMsg
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 5);

    const activeProducts = db
      .prepare('SELECT id, name, category, presentation, sale_price, stock, is_featured, is_bestseller FROM products WHERE is_active = 1 ORDER BY is_bestseller DESC, is_featured DESC LIMIT 50')
      .all() as any[];

    const matchedProducts =
      keywords.length > 0
        ? activeProducts
            .filter((p) =>
              keywords.some(
                (kw) =>
                  p.name.toLowerCase().includes(kw) ||
                  p.category.toLowerCase().includes(kw) ||
                  String(p.presentation || '').toLowerCase().includes(kw)
              )
            )
            .slice(0, 10)
        : activeProducts.slice(0, 8);

    const activePromos = db
      .prepare("SELECT title, description, discount_type, discount_value FROM promotions WHERE is_active = 1 AND publish_in_app = 1 LIMIT 8")
      .all() as any[];

    const allowedStoreTargets = ['inicio', 'catalogo', 'ofertas', 'seguimiento', 'cuenta', 'carrito'];
    const allowedAdminTargets = ['dashboard', 'orders', 'deliveries', 'pos', 'cash', 'inventory', 'billing', 'suppliers', 'reports', 'users', 'settings'];

    const systemInstruction = `Eres "Patty", la asistente virtual oficial de "Los Patrones Mini Market" en Honduras.
Tu misión principal es ayudar con mucha paciencia, claridad y lenguaje sencillo en español a personas que NO saben usar la aplicación (tanto clientes como personal del minimercado).

Reglas de estilo y formato:
- Habla de manera amable, cercana y muy fácil de entender (evita tecnicismos innecesarios).
- Siempre divide las instrucciones en pasos cortos y numerados dentro del arreglo "steps" (máximo 5 pasos claros).
- En "reply", da una respuesta directa, cálida y breve (2-3 oraciones máximo).
- Si la pregunta se resuelve yendo a una sección específica de la aplicación, sugiere en "action" el botón de navegación exacto. Si no hace falta navegar, omite "action".
- Sugiere 2 o 3 preguntas rápidas siguientes en "suggested_questions".

Información real del negocio (NO inventes precios ni horarios):
- Nombre: ${settings.business_name}
- Dirección: ${settings.address} (Coordenadas GPS: 15°36'43.9"N 87°56'21.0"W)
- Horario de atención: ${settings.hours}
- Pedido mínimo para envío a domicilio: L. ${Number(settings.min_order_amount || 70).toFixed(2)} (Recoger en tienda no tiene mínimo)
- Teléfonos: ${settings.phones}
- Zonas de entrega: ${(settings.delivery_zones || []).map((z: any) => `${z.name} (L. ${z.fee}, ${z.eta})`).join('; ')}
- Métodos de pago en línea: Efectivo contra entrega y Transferencia bancaria (${(settings.bank_accounts || []).map((b: any) => `${b.bank} ${b.account_number}`).join(' / ')})

Promociones activas:
${activePromos.length > 0 ? activePromos.map((pr) => `- ${pr.title}: ${pr.description}`).join('\n') : '- Consulta la pestaña Ofertas para promociones vigentes.'}

Muestra de productos disponibles (precios reales en Lempiras):
${matchedProducts.map((p) => `- ${p.name} (${p.presentation || p.category}): L. ${Number(p.sale_price).toFixed(2)} · Stock: ${p.stock}`).join('\n')}

Contexto actual del usuario:
- Modo actual: ${mode === 'admin' ? 'Sistema Central de Administración' : 'Tienda en Línea para Clientes'}
- Pantalla actual: ${currentScreen}
- Rol del usuario: ${userRole}
- Artículos en carrito: ${Number(context.cartCount || 0)}

Guía exacta de secciones de la Tienda en Línea (targets válidos en modo store: ${allowedStoreTargets.join(', ')}):
- "inicio": Logo, buscador superior, categorías, promociones, destacados y más vendidos.
- "catalogo": Todos los productos por categoría (Bebidas, Snacks, Abarrotes, Lácteos, Congelados, Limpieza, Higiene, Hogar, Otros). Botón "+ Agregar" añade al carrito.
- "ofertas": Productos con descuento y promociones activas.
- "carrito": Panel lateral derecho con botones +, -, eliminar, total y botón "Finalizar pedido". En Finalizar pedido el cliente elige "Envío a domicilio" (mínimo L. 70.00) o "Recoger en tienda", método de pago (Efectivo o Transferencia con subida de comprobante), puede pulsar "Ubicar en mapa" para mover el pin exacto de su casa, y pulsa "Confirmar pedido".
- "seguimiento": Escribir número de pedido (ej. PED-2026-0144) y pulsar "Buscar". Muestra el mapa con tienda, ruta, ubicación en tiempo real del repartidor cuando va "En camino", notificaciones y botón "Confirmar pedido recibido".
- "cuenta": Iniciar sesión / registrarse, ver historial de pedidos, descargar comprobantes en PDF y botón "Repetir pedido". (Cuenta demo cliente: cliente@correo.hn / clave 123456).

Guía exacta del Sistema Administrativo (targets válidos en modo admin: ${allowedAdminTargets.join(', ')}):
- "dashboard": Resumen de ventas del día/mes, pedidos pendientes, productos con inventario bajo/agotado y gráficos.
- "orders": Recibir pedidos en línea, revisar comprobante de transferencia, aceptar/rechazar, cambiar estado (En preparación, Listo para recoger, En camino, Entregado) y asignar repartidor.
- "deliveries": Para Administrador/Encargado es el Mapa de flota en vivo con entregas pendientes, activas, retrasadas (>40 min) y asignación de repartidor. Para Repartidor es su panel móvil con pedidos asignados, mapa de ruta, indicaciones paso a paso, botón "Abrir en Google Maps", "Iniciar entrega (Activar GPS)" y "Marcar entregado".
- "pos": Punto de Venta (POS). Escanear código de barras USB/inalámbrico o usar botón "Cámara" para escanear con cámara, o buscar manual. Cobrar en efectivo o transferencia y generar comprobante térmico o PDF.
- "cash": Apertura de caja con fondo inicial, registro de entradas/gastos y cierre/arqueo de caja.
- "inventory": Crear/editar productos, asignar múltiples códigos de barras (comerciales o internos), imprimir etiquetas, registrar entradas de mercadería y ajustes físicos con escáner.
- "billing": Historial de comprobantes de venta, descarga PDF/reimpresión y directorio de clientes.
- "suppliers": Proveedores, compras a proveedores (suman inventario) y campañas de promociones.
- "reports": Reportes por fecha exportables a Excel y PDF.
- "users": Gestión de usuarios por rol y bitácora de auditoría.
- "settings": Horarios, monto mínimo, coordenadas GPS tienda, impresoras, configuración de escáner de códigos de barras y respaldo JSON.

Regla crítica de target:
Solo usa targets válidos para el modo actual (${mode === 'admin' ? allowedAdminTargets.join(', ') : allowedStoreTargets.join(', ')}).`;

    const formattedHistory = (Array.isArray(history) ? history : [])
      .slice(-8)
      .map((h: any) => `${h.role === 'assistant' ? 'Asistente' : 'Usuario'}: ${String(h.text || '').slice(0, 400)}`)
      .join('\n');

    const prompt = formattedHistory
      ? `Historial reciente:\n${formattedHistory}\n\nPregunta actual del usuario: ${cleanMsg}`
      : `Pregunta del usuario: ${cleanMsg}`;

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Respuesta breve, amable y clara en español.',
              },
              steps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Pasos cortos y fáciles para guiar al usuario sin experiencia.',
              },
              suggested_questions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 o 3 preguntas frecuentes sugeridas para continuar.',
              },
              action: {
                type: Type.OBJECT,
                properties: {
                  target: {
                    type: Type.STRING,
                    description: 'Identificador exacto de la sección destino.',
                  },
                  label: {
                    type: Type.STRING,
                    description: 'Texto corto para el botón (ej. Ir al Catálogo).',
                  },
                },
              },
            },
            required: ['reply', 'steps', 'suggested_questions'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      const validTargets = mode === 'admin' ? allowedAdminTargets : allowedStoreTargets;
      const safeAction =
        parsed.action && parsed.action.target && validTargets.includes(parsed.action.target)
          ? { type: 'navigate' as const, target: String(parsed.action.target), label: String(parsed.action.label || 'Ir a sección') }
          : undefined;

      res.json({
        reply: String(parsed.reply || 'Con gusto te ayudo a usar el sistema paso a paso.'),
        steps: Array.isArray(parsed.steps) ? parsed.steps.map(String).slice(0, 6) : [],
        suggested_questions: Array.isArray(parsed.suggested_questions)
          ? parsed.suggested_questions.map(String).slice(0, 3)
          : [],
        action: safeAction,
      });
    } catch (err: any) {
      const msg = String(err?.message || 'Error al consultar el asistente.');
      const status =
        msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')
          ? 403
          : msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
            ? 429
            : 500;
      res.status(status).json({
        error:
          status === 403
            ? 'La clave de Gemini no es válida o no tiene permisos. Verifique Settings > Secrets.'
            : status === 429
              ? 'El asistente recibió muchas consultas seguidas. Intente nuevamente en unos segundos.'
              : 'No se pudo obtener respuesta del asistente en este momento.',
      });
    }
  });

  // --- VITE OR STATIC SERVE ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Los Patrones Mini Market server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
