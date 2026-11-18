import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'lospatrones.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime', '+24 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS business_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      business_name TEXT NOT NULL,
      logo_url TEXT DEFAULT '',
      address TEXT NOT NULL,
      phones TEXT NOT NULL,
      hours TEXT NOT NULL,
      min_order_amount REAL NOT NULL DEFAULT 70,
      store_lat REAL NOT NULL DEFAULT 15.612194,
      store_lng REAL NOT NULL DEFAULT -87.939167,
      delivery_zones TEXT NOT NULL,
      bank_accounts TEXT NOT NULL,
      fiscal_config TEXT NOT NULL,
      printer_config TEXT NOT NULL,
      notifications_config TEXT NOT NULL,
      scanner_config TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internal_code TEXT NOT NULL UNIQUE,
      barcode TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      presentation TEXT DEFAULT '',
      category TEXT NOT NULL,
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0.15,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 5,
      expiry_date TEXT,
      image_url TEXT DEFAULT '',
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_bestseller INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      old_purchase_price REAL NOT NULL,
      new_purchase_price REAL NOT NULL,
      old_sale_price REAL NOT NULL,
      new_sale_price REAL NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      scope TEXT NOT NULL,
      target_product_id INTEGER,
      target_category TEXT,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      publish_in_app INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      banner_image_url TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT DEFAULT '',
      rtn TEXT DEFAULT '',
      razon_social TEXT DEFAULT '',
      addresses TEXT NOT NULL DEFAULT '[]',
      notes TEXT DEFAULT '',
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      customer_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT DEFAULT '',
      customer_rtn TEXT DEFAULT '',
      delivery_mode TEXT NOT NULL,
      delivery_address TEXT DEFAULT '',
      delivery_reference TEXT DEFAULT '',
      delivery_notes TEXT DEFAULT '',
      delivery_zone_name TEXT DEFAULT '',
      delivery_fee REAL NOT NULL DEFAULT 0,
      delivery_lat REAL,
      delivery_lng REAL,
      estimated_distance_km REAL,
      estimated_duration_min INTEGER,
      dispatched_at TEXT,
      delivered_at TEXT,
      customer_confirmed_at TEXT,
      near_notified INTEGER NOT NULL DEFAULT 0,
      driver_started_at TEXT,
      payment_method TEXT NOT NULL,
      transfer_proof_url TEXT DEFAULT '',
      cash_received REAL NOT NULL DEFAULT 0,
      change_given REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      rejection_reason TEXT DEFAULT '',
      assigned_driver_id INTEGER,
      assigned_driver_name TEXT DEFAULT '',
      created_by_user_id INTEGER,
      created_by_name TEXT DEFAULT '',
      tracking_token TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      internal_code TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0.15,
      line_total REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL,
      cai TEXT NOT NULL,
      rango_autorizado TEXT NOT NULL,
      fecha_limite_emision TEXT NOT NULL,
      emitter_name TEXT NOT NULL,
      emitter_rtn TEXT NOT NULL,
      emitter_address TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_rtn TEXT NOT NULL,
      subtotal_exento REAL NOT NULL DEFAULT 0,
      subtotal_gravado_15 REAL NOT NULL DEFAULT 0,
      isv_15 REAL NOT NULL DEFAULT 0,
      discount_total REAL NOT NULL DEFAULT 0,
      delivery_fee REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      amount_in_words TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'emitida',
      credit_note_number TEXT DEFAULT '',
      void_reason TEXT DEFAULT '',
      voided_by TEXT DEFAULT '',
      voided_at TEXT,
      issued_by TEXT NOT NULL,
      issued_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_by_id INTEGER NOT NULL,
      opened_by_name TEXT NOT NULL,
      opening_amount REAL NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      closed_by_id INTEGER,
      closed_by_name TEXT,
      closed_at TEXT,
      counted_cash REAL,
      expected_cash REAL,
      difference REAL,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'abierta'
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      concept TEXT NOT NULL,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (session_id) REFERENCES cash_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      reason TEXT NOT NULL,
      batch_expiry TEXT,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rtn TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      products_supplied TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      document_number TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      total_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pendiente',
      notes TEXT DEFAULT '',
      created_by TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      batch_expiry TEXT,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      code_type TEXT NOT NULL DEFAULT 'comercial',
      presentation_label TEXT DEFAULT '',
      price_override REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS driver_locations (
      driver_id INTEGER PRIMARY KEY,
      order_id INTEGER,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      heading REAL NOT NULL DEFAULT 0,
      speed_kmh REAL NOT NULL DEFAULT 0,
      accuracy_m REAL NOT NULL DEFAULT 0,
      is_tracking INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS delivery_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      target_role TEXT NOT NULL,
      target_user_id INTEGER,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  migrateSchema();
  seedIfEmpty();
  ensureProductBarcodesBackfilled();
  ensureDeliveryGeoBackfilled();
}

function migrateSchema(): void {
  const settingsCols = db.prepare('PRAGMA table_info(business_settings)').all() as { name: string }[];
  if (!settingsCols.some((c) => c.name === 'scanner_config')) {
    db.exec("ALTER TABLE business_settings ADD COLUMN scanner_config TEXT NOT NULL DEFAULT '{}'");
  }
  if (!settingsCols.some((c) => c.name === 'store_lat')) {
    db.exec('ALTER TABLE business_settings ADD COLUMN store_lat REAL NOT NULL DEFAULT 15.612194');
  }
  if (!settingsCols.some((c) => c.name === 'store_lng')) {
    db.exec('ALTER TABLE business_settings ADD COLUMN store_lng REAL NOT NULL DEFAULT -87.939167');
  }

  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (!sessionCols.some((c) => c.name === 'expires_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN expires_at TEXT');
  }
  db.exec("UPDATE sessions SET expires_at = datetime(created_at, '+24 hours') WHERE expires_at IS NULL");

  const orderCols = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  const orderAlterations: [string, string][] = [
    ['delivery_lat', 'REAL'],
    ['delivery_lng', 'REAL'],
    ['estimated_distance_km', 'REAL'],
    ['estimated_duration_min', 'INTEGER'],
    ['dispatched_at', 'TEXT'],
    ['delivered_at', 'TEXT'],
    ['customer_confirmed_at', 'TEXT'],
    ['near_notified', 'INTEGER NOT NULL DEFAULT 0'],
    ['driver_started_at', 'TEXT'],
    ['tracking_token', "TEXT DEFAULT ''"],
  ];
  for (const [col, def] of orderAlterations) {
    if (!orderCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
    }
  }
  db.exec("UPDATE orders SET tracking_token = lower(hex(randomblob(16))) WHERE tracking_token IS NULL OR tracking_token = ''");

  const defaultScanner = JSON.stringify({
    hid_enabled: true,
    suffix_key: 'Enter',
    auto_focus_pos: true,
    beep_on_scan: true,
    camera_enabled: true,
    preferred_camera_facing: 'environment',
    auto_increment_qty: true,
  });
  db.prepare("UPDATE business_settings SET scanner_config = ? WHERE scanner_config = '{}' OR scanner_config IS NULL").run(
    defaultScanner
  );

  // Enforce updated store location, phone (+504 95761563), logo, coordinates, 6 AM - 11 PM schedule, and L. 70 minimum order
  db.prepare(
    `UPDATE business_settings SET
      logo_url = CASE WHEN logo_url = '' OR logo_url IS NULL THEN '/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png' ELSE logo_url END,
      address = CASE WHEN address LIKE '%San Pedro Sula%' OR address = '' THEN 'Residencial San Carlos, Primer Parqueo, Choloma, Cortés, Honduras' ELSE address END,
      phones = CASE WHEN phones LIKE '%2550-4820%' OR phones = '' THEN '+504 95761563' ELSE phones END,
      store_lat = COALESCE(NULLIF(store_lat, 0), 15.612194),
      store_lng = COALESCE(NULLIF(store_lng, 0), -87.939167),
      hours = CASE WHEN hours = 'Lun - Sáb: 7:00 AM - 9:00 PM · Dom: 8:00 AM - 6:00 PM' THEN 'Lun - Dom: 6:00 AM - 11:00 PM' ELSE hours END,
      min_order_amount = CASE WHEN min_order_amount = 150 THEN 70 ELSE min_order_amount END
     WHERE id = 1`
  ).run();
}

function ensureDeliveryGeoBackfilled(): void {
  // Ensure demo online delivery orders exist if an earlier partial DB missed them
  const onlineCount = (db.prepare("SELECT COUNT(*) as c FROM orders WHERE channel = 'online'").get() as { c: number }).c;
  if (onlineCount === 0) {
    const c1 = db.prepare('SELECT id FROM customers ORDER BY id ASC LIMIT 1').get() as any;
    const c2 = db.prepare('SELECT id FROM customers ORDER BY id ASC LIMIT 1 OFFSET 1').get() as any;
    const driver = db.prepare("SELECT id, name FROM users WHERE role = 'Repartidor' LIMIT 1").get() as any;
    const cliente = db.prepare("SELECT id, name FROM users WHERE role = 'Cliente' LIMIT 1").get() as any;
    const prodList = db.prepare('SELECT id, internal_code, name FROM products ORDER BY id ASC LIMIT 16').all() as any[];
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_number, channel, customer_id, customer_name, customer_phone, customer_rtn,
        delivery_mode, delivery_address, delivery_reference, delivery_notes, delivery_zone_name,
        delivery_fee, payment_method, transfer_proof_url, cash_received, change_given,
        subtotal, discount_total, tax_total, total, status, assigned_driver_id, assigned_driver_name,
        created_by_user_id, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, internal_code, quantity, unit_price, discount_amount, tax_rate, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const driverId = driver?.id ?? 5;
    const driverName = driver?.name ?? 'Josué Paz';
    const c1Id = c1?.id ?? null;
    const c2Id = c2?.id ?? c1Id;
    const cliUserId = cliente?.id ?? null;

    if (prodList.length >= 15) {
      const o2 = insertOrder.run(
        'PED-2026-0142', 'online', c1Id, 'Andrea Castillo', '+504 9821-4400', '05011992048123',
        'domicilio', 'Col. Jardines del Valle, 4ta Calle, Casa #18', 'Portón negro frente a parque central', 'Tocar timbre al llegar',
        'Jardines del Valle / Trejo', 45, 'efectivo', '', 0, 0,
        254, 14.4, 7.6, 299, 'entregado', driverId, driverName,
        cliUserId, 'Andrea Castillo',
        new Date(Date.now() - 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' '),
        new Date(Date.now() - 25 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
      );
      insertOrderItem.run(Number(o2.lastInsertRowid), prodList[0].id, prodList[0].name, prodList[0].internal_code, 2, 48, 14.4, 0.15, 81.6);
      insertOrderItem.run(Number(o2.lastInsertRowid), prodList[8].id, prodList[8].name, prodList[8].internal_code, 2, 52, 0, 0, 104);
      insertOrderItem.run(Number(o2.lastInsertRowid), prodList[7].id, prodList[7].name, prodList[7].internal_code, 2, 32, 0, 0, 64);

      const o3 = insertOrder.run(
        'PED-2026-0143', 'online', c1Id, 'Andrea Castillo', '+504 9821-4400', '05011992048123',
        'domicilio', 'Col. Jardines del Valle, 4ta Calle, Casa #18', 'Portón negro frente a parque central', 'Llamar 5 minutos antes',
        'Jardines del Valle / Trejo', 45, 'transferencia', '', 0, 0,
        245, 0, 11.2, 290, 'recibido', null, '',
        cliUserId, 'Andrea Castillo',
        new Date(Date.now() - 18 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
        new Date(Date.now() - 18 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
      );
      insertOrderItem.run(Number(o3.lastInsertRowid), prodList[10].id, prodList[10].name, prodList[10].internal_code, 2, 32, 0, 0, 64);
      insertOrderItem.run(Number(o3.lastInsertRowid), prodList[11].id, prodList[11].name, prodList[11].internal_code, 1, 95, 0, 0, 95);
      insertOrderItem.run(Number(o3.lastInsertRowid), prodList[4].id, prodList[4].name, prodList[4].internal_code, 1, 65, 0, 0.15, 65);
      insertOrderItem.run(Number(o3.lastInsertRowid), prodList[3].id, prodList[3].name, prodList[3].internal_code, 1, 26, 0, 0.15, 26);

      const o4 = insertOrder.run(
        'PED-2026-0144', 'online', c2Id, 'Roberto Morales', '+504 9940-1122', '05011985012934',
        'domicilio', 'Bo. El Centro, 2da Ave, Local 14', 'A dos cuadras del parque central', 'Entregar en caja del local',
        'Barrio El Centro / Casco Urbano', 35, 'efectivo', '', 500, 0,
        220, 0, 14.35, 255, 'en_camino', driverId, driverName,
        3, 'Mario Zelaya',
        new Date(Date.now() - 42 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
        new Date(Date.now() - 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
      );
      insertOrderItem.run(Number(o4.lastInsertRowid), prodList[13].id, prodList[13].name, prodList[13].internal_code, 1, 115, 0, 0, 115);
      insertOrderItem.run(Number(o4.lastInsertRowid), prodList[14].id, prodList[14].name, prodList[14].internal_code, 1, 110, 0, 0.15, 110);
    }
  }

  // Ensure existing seeded delivery orders have realistic coordinates near 15.612194, -87.939167
  db.prepare(
    `UPDATE orders SET delivery_lat = 15.5964, delivery_lng = -87.9512, estimated_distance_km = 2.6, estimated_duration_min = 9
     WHERE order_number = 'PED-2026-0142' AND delivery_lat IS NULL`
  ).run();
  db.prepare(
    `UPDATE orders SET delivery_lat = 15.5964, delivery_lng = -87.9512, estimated_distance_km = 2.6, estimated_duration_min = 9
     WHERE order_number = 'PED-2026-0143' AND delivery_lat IS NULL`
  ).run();
  db.prepare(
    `UPDATE orders SET delivery_lat = 15.6038, delivery_lng = -87.9438, estimated_distance_km = 1.4, estimated_duration_min = 6,
      dispatched_at = COALESCE(dispatched_at, updated_at), driver_started_at = COALESCE(driver_started_at, updated_at)
     WHERE order_number = 'PED-2026-0144' AND delivery_lat IS NULL`
  ).run();

  // If PED-2026-0144 is still en_camino and driver 5 has no location row yet, seed active position along route
  const activeOrder = db.prepare("SELECT id, assigned_driver_id, status FROM orders WHERE order_number = 'PED-2026-0144'").get() as any;
  if (activeOrder && activeOrder.status === 'en_camino' && activeOrder.assigned_driver_id) {
    const existingLoc = db.prepare('SELECT driver_id FROM driver_locations WHERE driver_id = ?').get(activeOrder.assigned_driver_id);
    if (!existingLoc) {
      db.prepare(
        `INSERT INTO driver_locations (driver_id, order_id, lat, lng, heading, speed_kmh, accuracy_m, is_tracking)
         VALUES (?, ?, 15.6085, -87.9412, 210, 28, 12, 1)`
      ).run(activeOrder.assigned_driver_id, activeOrder.id);
    }
    const existingNotif = db.prepare('SELECT id FROM delivery_notifications WHERE order_id = ?').get(activeOrder.id);
    if (!existingNotif) {
      db.prepare(
        `INSERT INTO delivery_notifications (order_id, target_role, target_user_id, event_type, title, message)
         VALUES (?, 'customer', NULL, 'order_dispatched', 'Pedido en camino', 'Tu pedido salió del establecimiento con el repartidor Josué Paz.')`
      ).run(activeOrder.id);
    }
  }
}

function ensureProductBarcodesBackfilled(): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM product_barcodes').get() as { c: number }).c;
  if (count > 0) return;

  const products = db.prepare('SELECT id, internal_code, barcode, presentation FROM products').all() as any[];
  const insertBc = db.prepare(
    `INSERT OR IGNORE INTO product_barcodes (product_id, code, code_type, presentation_label, price_override)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const p of products) {
    if (p.barcode) {
      insertBc.run(p.id, p.barcode, 'comercial', p.presentation || '', null);
    }
    if (p.internal_code) {
      insertBc.run(p.id, p.internal_code, 'interno', p.presentation || '', null);
    }
  }
  // Seed a secondary barcode on Coca-Cola Original 2L (LP-001) to showcase multi-barcode per product
  const coca = db.prepare("SELECT id FROM products WHERE internal_code = 'LP-001'").get() as any;
  if (coca) {
    insertBc.run(coca.id, '7401001100998', 'comercial', 'Botella 2 Litros (Lote Especial)', null);
  }
}

function seedIfEmpty(): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  const passwordHash = bcrypt.hashSync('123456', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  insertUser.run('Carlos Mendoza', 'admin@lospatrones.hn', '+504 9845-1290', passwordHash, 'Administrador');
  insertUser.run('Lucía Fernández', 'caja@lospatrones.hn', '+504 9912-3344', passwordHash, 'Cajero');
  insertUser.run('Mario Zelaya', 'pedidos@lospatrones.hn', '+504 9734-5511', passwordHash, 'Encargado de pedidos');
  insertUser.run('Elena Ramírez', 'inventario@lospatrones.hn', '+504 9611-8820', passwordHash, 'Encargado de inventario');
  insertUser.run('Josué Paz', 'repartidor@lospatrones.hn', '+504 9502-7741', passwordHash, 'Repartidor');
  const clienteRes = insertUser.run('Andrea Castillo', 'cliente@correo.hn', '+504 9821-4400', passwordHash, 'Cliente');
  const clienteUserId = Number(clienteRes.lastInsertRowid);

  // Business Settings
  const deliveryZones = [
    { id: 'centro', name: 'Residencial San Carlos / Alrededores', fee: 25, eta: '15 - 25 min', active: true },
    { id: 'jardines', name: 'Choloma Centro / Casco Urbano', fee: 35, eta: '20 - 30 min', active: true },
    { id: 'alamos', name: 'López Arellano / Col. Cerro Verde', fee: 45, eta: '25 - 40 min', active: true },
    { id: 'universidad', name: 'Quebrada Seca / Río Blanquito', fee: 55, eta: '30 - 45 min', active: true },
  ];

  const bankAccounts = [
    {
      id: 'bac',
      bank: 'BAC Credomatic',
      account_number: '742819043',
      account_type: 'Cuenta de Cheques',
      holder: 'Inversiones Los Patrones S. de R.L.',
    },
    {
      id: 'atlantida',
      bank: 'Banco Atlántida',
      account_number: '11029485712',
      account_type: 'Cuenta de Ahorro',
      holder: 'Inversiones Los Patrones S. de R.L.',
    },
    {
      id: 'ficohsa',
      bank: 'Banco Ficohsa',
      account_number: '200014829104',
      account_type: 'Cuenta Empresarial',
      holder: 'Inversiones Los Patrones S. de R.L.',
    },
  ];

  const fiscalConfig = {
    rtn: '05019018472910',
    razon_social: 'Inversiones Los Patrones S. de R.L.',
    cai: '384F2A-91C4B2-4E8D11-7A90E3-C51B20-9F',
    punto_emision: '000-001-01',
    rango_inicial: 1,
    rango_final: 5000,
    correlativo_actual: 142,
    fecha_limite_emision: '2027-06-30',
    isv_rate: 0.15,
    modalidad: 'Sistema Computarizado / Autoimpresión Autorizada SAR',
    mensaje_pie: 'Original: Cliente · Copia: Obligado Tributario Emisor. La factura es beneficio de todos, ¡Exíjala!',
  };

  const printerConfig = {
    thermal_width: '80mm',
    auto_print_pos: true,
    open_cash_drawer: true,
    conventional_format: 'Carta',
    printer_name: 'Epson TM-T20III Térmica 80mm',
  };

  const notificationsConfig = {
    sound_new_order: true,
    low_stock_alert: true,
    expiry_alert_days: 30,
  };

  db.prepare(`
    INSERT INTO business_settings (
      id, business_name, logo_url, address, phones, hours, min_order_amount, store_lat, store_lng,
      delivery_zones, bank_accounts, fiscal_config, printer_config, notifications_config
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Los Patrones Mini Market',
    '/assets/aistudio/_cono_azul_de_compras_con_carrito_amarillo_b017e67b.png',
    'Residencial San Carlos, Primer Parqueo, Choloma, Cortés, Honduras',
    '+504 95761563',
    'Lun - Dom: 6:00 AM - 11:00 PM',
    70,
    15.612194,
    -87.939167,
    JSON.stringify(deliveryZones),
    JSON.stringify(bankAccounts),
    JSON.stringify(fiscalConfig),
    JSON.stringify(printerConfig),
    JSON.stringify(notificationsConfig)
  );

  // Customers
  const insertCustomer = db.prepare(`
    INSERT INTO customers (name, phone, email, rtn, razon_social, addresses, notes, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const c1 = insertCustomer.run(
    'Andrea Castillo',
    '+504 9821-4400',
    'cliente@correo.hn',
    '05011992048123',
    'Andrea Sofía Castillo',
    JSON.stringify([
      {
        id: 'addr-1',
        label: 'Casa Principal',
        address: 'Col. Jardines del Valle, 4ta Calle, Casa #18',
        reference: 'Portón negro frente a parque central',
        zone_id: 'jardines',
      },
      {
        id: 'addr-2',
        label: 'Oficina',
        address: 'Bo. Río de Piedras, Ave. Circunvalación, Edificio Torres del Valle, Piso 3',
        reference: 'Recepción planta baja',
        zone_id: 'alamos',
      },
    ]),
    'Cliente frecuente, prefiere entregas en horario matutino.',
    clienteUserId
  );

  const c2 = insertCustomer.run(
    'Roberto Morales',
    '+504 9940-1122',
    'rmorales@empresa.hn',
    '05011985012934',
    'Comercial Morales S.A.',
    JSON.stringify([
      {
        id: 'addr-3',
        label: 'Local Comercial',
        address: 'Bo. El Centro, 2da Ave, Local 14',
        reference: 'A dos cuadras del parque central',
        zone_id: 'centro',
      },
    ]),
    'Solicita factura con RTN en todas sus compras.',
    null
  );

  // Products across all 9 categories using local generated images
  const IMG_BEV = '/src/assets/images/prod_beverages_pack_1794949337759.jpg';
  const IMG_SNK = '/src/assets/images/prod_snacks_assortment_1794949338101.jpg';
  const IMG_GRO = '/src/assets/images/prod_groceries_staples_1794949338230.jpg';
  const IMG_DRY = '/src/assets/images/prod_dairy_fresh_1794949337700.jpg';
  const IMG_CLN = '/src/assets/images/prod_cleaning_home_1794949339439.jpg';
  const IMG_HYG = '/src/assets/images/prod_hygiene_care_1794949340523.jpg';
  const IMG_PRO = '/src/assets/images/promo_banner_drinks_snacks_1794949337733.jpg';

  const insertProd = db.prepare(`
    INSERT INTO products (
      internal_code, barcode, name, description, brand, presentation, category,
      purchase_price, sale_price, tax_rate, stock, min_stock, expiry_date, image_url,
      is_featured, is_bestseller, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const productsSeed: Array<[string, string, string, string, string, string, string, number, number, number, number, number, string | null, string, number, number]> = [
    ['LP-001', '7401001100011', 'Coca-Cola Original 2L', 'Bebida carbonatada sabor cola clásica en botella familiar.', 'Coca-Cola', 'Botella 2 Litros', 'Bebidas', 34, 48, 0.15, 42, 10, '2027-04-15', IMG_BEV, 1, 1],
    ['LP-002', '7401001100028', 'Jugo de Naranja Natural Sula', 'Jugo 100% pasteurizado de naranja fresca sin azúcar añadida.', 'Sula', 'Envase 946 ml', 'Bebidas', 28, 40, 0.15, 24, 8, '2026-12-10', IMG_BEV, 1, 1],
    ['LP-003', '7401001100035', 'Agua Mineral Azul 600ml', 'Agua purificada de manantial en presentación personal.', 'Azul', 'Botella 600 ml', 'Bebidas', 8, 15, 0.0, 95, 20, '2027-11-30', IMG_PRO, 0, 1],
    ['LP-004', '7401002200014', 'Tortrix Sal y Limón Familiar', 'Crujientes tortillas de maíz tostadas con toque de sal y limón.', 'Diana', 'Bolsa 180 g', 'Snacks y golosinas', 16, 26, 0.15, 36, 10, '2027-02-20', IMG_SNK, 1, 1],
    ['LP-005', '7401002200021', 'Chocolate Oscuro Artesanal 70%', 'Tableta de cacao hondureño tostado de origen único.', 'Cacao Real', 'Barra 100 g', 'Snacks y golosinas', 42, 65, 0.15, 18, 6, '2027-05-01', IMG_SNK, 1, 0],
    ['LP-006', '7401002200038', 'Marañón Tostado con Sal Marina', 'Semillas selectas de marañón tostadas al horno en frasco.', 'Aurora', 'Frasco 250 g', 'Snacks y golosinas', 88, 125, 0.15, 4, 6, '2027-01-15', IMG_SNK, 0, 0],
    ['LP-007', '7401003300017', 'Café Molido Copán Tueste Medio', 'Café de altura cultivado en Copán, aroma intenso y cuerpo balanceado.', 'Highland Beans', 'Bolsa 340 g', 'Abarrotes', 78, 118, 0.0, 28, 8, '2027-08-30', IMG_GRO, 1, 1],
    ['LP-008', '7401003300024', 'Arroz Blanco Grano Largo', 'Arroz seleccionado de grano entero limpio y rendidor.', 'Oro Blanco', 'Bolsa 2 lb', 'Abarrotes', 22, 32, 0.0, 60, 15, '2027-10-10', IMG_GRO, 0, 1],
    ['LP-009', '7401003300031', 'Frijoles Rojos Hondureños', 'Frijol rojo seda de cosecha nacional seleccionado.', 'El Faro', 'Bolsa 2 lb', 'Abarrotes', 36, 52, 0.0, 44, 12, '2027-09-12', IMG_GRO, 1, 1],
    ['LP-010', '7401003300048', 'Aceite Vegetal Puro Sol Oro', 'Aceite vegetal 100% puro ideal para freír y cocinar.', 'Sol Oro', 'Botella 750 ml', 'Abarrotes', 45, 64, 0.0, 31, 8, '2027-07-18', IMG_GRO, 0, 1],
    ['LP-011', '7401004400010', 'Leche Entera Fresca Leyde', 'Leche pasteurizada grado A fortificada con vitaminas A y D.', 'Leyde', 'Bolsa 946 ml', 'Lácteos', 23, 32, 0.0, 22, 10, '2026-11-28', IMG_DRY, 1, 1],
    ['LP-012', '7401004400027', 'Queso Semiseco Artesanal', 'Queso fresco prensado elaborado en Olancho con leche pura.', 'La Pradera', 'Libra 454 g', 'Lácteos', 68, 95, 0.0, 14, 5, '2026-12-05', IMG_DRY, 1, 0],
    ['LP-013', '7401004400034', 'Mantequilla Crema Natural', 'Mantequilla cremosa tradicional sin conservantes artificiales.', 'Sula', 'Empaque 225 g', 'Lácteos', 24, 36, 0.0, 3, 6, '2026-12-12', IMG_DRY, 0, 1],
    ['LP-014', '7401005500013', 'Pechuga de Pollo Congelada', 'Filetes de pechuga sin hueso empacados al vacío.', 'Pollo Norteño', 'Bandeja 2 lb', 'Productos congelados', 82, 115, 0.0, 16, 5, '2027-03-10', IMG_DRY, 0, 1],
    ['LP-015', '7401005500020', 'Helado Napolitano Familiar', 'Helado cremoso triple sabor fresa, vainilla y chocolate.', 'Sarita', 'Envase 1.5 L', 'Productos congelados', 74, 110, 0.15, 9, 4, '2027-04-22', IMG_DRY, 1, 0],
    ['LP-016', '7401006600016', 'Detergente Líquido Frescura Alpina', 'Detergente concentrado para ropa blanca y de color, 33 lavadas.', 'Xedex', 'Botella 1.8 L', 'Limpieza', 92, 135, 0.15, 20, 6, null, IMG_CLN, 1, 0],
    ['LP-017', '7401006600023', 'Limpiador Multiusos Desinfectante', 'Elimina el 99.9% de bacterias con agradable aroma cítrico.', 'Fabuloso', 'Atomizador 500 ml', 'Limpieza', 32, 48, 0.15, 26, 8, null, IMG_CLN, 0, 1],
    ['LP-018', '7401007700019', 'Shampoo Botánico Avena y Miel', 'Limpieza suave hidratante libre de parabenos para uso diario.', 'Seed & Sprout', 'Frasco 400 ml', 'Higiene personal', 78, 118, 0.15, 15, 5, '2028-01-15', IMG_HYG, 1, 0],
    ['LP-019', '7401007700026', 'Pasta Dental Menta Fresca', 'Protección completa contra caries y aliento fresco duradero.', 'Colgate', 'Tubo 100 ml', 'Higiene personal', 26, 42, 0.15, 0, 8, '2027-11-01', IMG_HYG, 0, 0],
    ['LP-020', '7401008800012', 'Paños de Microfibra Multiuso', 'Set de 3 paños absorbentes reutilizables para cocina y hogar.', 'Scotch-Brite', 'Paquete x 3', 'Productos para el hogar', 44, 68, 0.15, 19, 5, null, IMG_CLN, 0, 0],
    ['LP-021', '7401009900015', 'Baterías Alcalinas AA Pack x4', 'Pilas de larga duración para controles, relojes y linternas.', 'Duracell', 'Blíster x 4', 'Otros productos', 48, 75, 0.15, 25, 6, '2030-01-01', IMG_CLN, 0, 0],
  ];

  const prodIds: number[] = [];
  for (const p of productsSeed) {
    const res = insertProd.run(...p);
    prodIds.push(Number(res.lastInsertRowid));
  }

  // Promotions (No loyalty points, memberships, or rewards)
  const insertPromo = db.prepare(`
    INSERT INTO promotions (
      title, description, scope, target_product_id, target_category,
      discount_type, discount_value, start_date, end_date, publish_in_app, is_active, banner_image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPromo.run(
    'Semana de Bebidas y Snacks -15%',
    'Disfruta un 15% de descuento en toda la categoría de Bebidas por tiempo limitado.',
    'category',
    null,
    'Bebidas',
    'percentage',
    15,
    '2026-01-01',
    '2027-12-31',
    1,
    1,
    IMG_PRO
  );

  insertPromo.run(
    'Precio Especial Café Copán',
    'Llévate el Café Molido Copán 340g a precio especial de temporada.',
    'product',
    prodIds[6],
    null,
    'special_price',
    98,
    '2026-01-01',
    '2027-12-31',
    1,
    1,
    IMG_GRO
  );

  // Suppliers & Purchases
  const insertSup = db.prepare(`
    INSERT INTO suppliers (name, rtn, contact_name, phone, email, products_supplied, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const sup1 = insertSup.run(
    'Distribuidora Sula y Lácteos S.A.',
    '05019002381920',
    'Fernando Aguilar',
    '+504 2552-9010',
    'ventas@distsula.hn',
    'Leches, jugos, quesos, mantequilla y helados',
    'Entrega los días martes y viernes antes de las 10:00 AM.'
  );
  const sup2 = insertSup.run(
    'Abarrotería Mayorista del Norte',
    '05019011827364',
    'Claudia Bueso',
    '+504 2557-4120',
    'pedidos@mayoristanorte.hn',
    'Arroz, frijoles, aceite, café, detergentes y snacks',
    'Crédito a 15 días con factura SAR.'
  );

  const insertPurchase = db.prepare(`
    INSERT INTO purchases (supplier_id, document_number, purchase_date, total_cost, status, notes, created_by, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const pRes = insertPurchase.run(
    Number(sup2.lastInsertRowid),
    'FAC-PROV-00841',
    '2026-11-15',
    3500,
    'confirmada',
    'Reposición semanal de abarrotes básicos',
    'Elena Ramírez',
    '2026-11-15 09:30:00'
  );
  db.prepare(`
    INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, line_total, batch_expiry)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(pRes.lastInsertRowid), prodIds[7], 'Arroz Blanco Grano Largo', 50, 22, 1100, '2027-10-10');
  db.prepare(`
    INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, line_total, batch_expiry)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(pRes.lastInsertRowid), prodIds[8], 'Frijoles Rojos Hondureños', 40, 36, 1440, '2027-09-12');
  db.prepare(`
    INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, line_total, batch_expiry)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(pRes.lastInsertRowid), prodIds[6], 'Café Molido Copán Tueste Medio', 12, 80, 960, '2027-08-30');

  // Open Cash Session for today
  db.prepare(`
    INSERT INTO cash_sessions (opened_by_id, opened_by_name, opening_amount, opened_at, status)
    VALUES (2, 'Lucía Fernández', 1500, datetime('now', 'localtime', '-3 hours'), 'abierta')
  `).run();

  // Historical closed session so "Historial de cierres" is populated
  db.prepare(`
    INSERT INTO cash_sessions (
      opened_by_id, opened_by_name, opening_amount, opened_at,
      closed_by_id, closed_by_name, closed_at, counted_cash, expected_cash, difference, notes, status
    ) VALUES (
      2, 'Lucía Fernández', 1500, datetime('now', 'localtime', '-1 day', '-10 hours'),
      2, 'Lucía Fernández', datetime('now', 'localtime', '-1 day'), 4820, 4820, 0, 'Cierre sin novedades.', 'cerrada'
    )
  `).run();

  // Sample Orders & SAR Invoices (POS + Online)
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_number, channel, customer_id, customer_name, customer_phone, customer_rtn,
      delivery_mode, delivery_address, delivery_reference, delivery_notes, delivery_zone_name,
      delivery_fee, payment_method, transfer_proof_url, cash_received, change_given,
      subtotal, discount_total, tax_total, total, status, assigned_driver_id, assigned_driver_name,
      created_by_user_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, internal_code, quantity, unit_price, discount_amount, tax_rate, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id, cai, rango_autorizado, fecha_limite_emision,
      emitter_name, emitter_rtn, emitter_address, customer_name, customer_rtn,
      subtotal_exento, subtotal_gravado_15, isv_15, discount_total, delivery_fee,
      total, amount_in_words, payment_method, status, issued_by, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitida', ?, ?)
  `);

  // Order 1: Completed POS sale today
  const o1 = insertOrder.run(
    'POS-2026-0141', 'pos', Number(c2.lastInsertRowid), 'Roberto Morales', '+504 9940-1122', '05011985012934',
    'recoger', 'Tienda Física', '', '', 'Mostrador',
    0, 'efectivo', '', 500, 179.0,
    290, 0, 31.0, 321, 'entregado', null, '',
    2, 'Lucía Fernández',
    new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' '),
    new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  );
  insertOrderItem.run(Number(o1.lastInsertRowid), prodIds[6], 'Café Molido Copán Tueste Medio', 'LP-007', 2, 98, 0, 0, 196);
  insertOrderItem.run(Number(o1.lastInsertRowid), prodIds[15], 'Detergente Líquido Frescura Alpina', 'LP-016', 1, 135, 0, 0.15, 125);

  insertInvoice.run(
    '000-001-01-00000141', Number(o1.lastInsertRowid),
    fiscalConfig.cai, '000-001-01-00000001 al 000-001-01-00005000', fiscalConfig.fecha_limite_emision,
    fiscalConfig.razon_social, fiscalConfig.rtn,
    'Residencial San Carlos, Primer Parqueo, Choloma, Cortés',
    'Comercial Morales S.A.', '05011985012934',
    196, 108.7, 16.3, 0, 0, 321,
    'TRESCIENTOS VEINTIUN LEMPIRAS CON 00/100',
    'efectivo', 'Lucía Fernández',
    new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  );

  // Order 2: Delivered Online order (so customer Andrea can see history, download invoice, and repeat order!)
  const o2 = insertOrder.run(
    'PED-2026-0142', 'online', Number(c1.lastInsertRowid), 'Andrea Castillo', '+504 9821-4400', '05011992048123',
    'domicilio', 'Col. Jardines del Valle, 4ta Calle, Casa #18', 'Portón negro frente a parque central', 'Tocar timbre al llegar',
    'Jardines del Valle / Trejo', 45, 'efectivo', '', 0, 0,
    254, 14.4, 7.6, 299, 'entregado', 5, 'Josué Paz',
    clienteUserId, 'Andrea Castillo',
    new Date(Date.now() - 26 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' '),
    new Date(Date.now() - 25 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  );
  insertOrderItem.run(Number(o2.lastInsertRowid), prodIds[0], 'Coca-Cola Original 2L', 'LP-001', 2, 48, 14.4, 0.15, 81.6);
  insertOrderItem.run(Number(o2.lastInsertRowid), prodIds[8], 'Frijoles Rojos Hondureños', 'LP-009', 2, 52, 0, 0, 104);
  insertOrderItem.run(Number(o2.lastInsertRowid), prodIds[7], 'Arroz Blanco Grano Largo', 'LP-008', 2, 32, 0, 0, 64);

  insertInvoice.run(
    '000-001-01-00000142', Number(o2.lastInsertRowid),
    fiscalConfig.cai, '000-001-01-00000001 al 000-001-01-00005000', fiscalConfig.fecha_limite_emision,
    fiscalConfig.razon_social, fiscalConfig.rtn,
    'Residencial San Carlos, Primer Parqueo, Choloma, Cortés',
    'Andrea Sofía Castillo', '05011992048123',
    168, 70.96, 10.64, 14.4, 45, 299,
    'DOSCIENTOS NOVENTA Y NUEVE LEMPIRAS CON 00/100',
    'efectivo', 'Mario Zelaya',
    new Date(Date.now() - 25 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  );

  // Order 3: Active Online Order waiting in queue ('recibido')
  const o3 = insertOrder.run(
    'PED-2026-0143', 'online', Number(c1.lastInsertRowid), 'Andrea Castillo', '+504 9821-4400', '05011992048123',
    'domicilio', 'Col. Jardines del Valle, 4ta Calle, Casa #18', 'Portón negro frente a parque central', 'Llamar 5 minutos antes',
    'Jardines del Valle / Trejo', 45, 'transferencia', '', 0, 0,
    245, 0, 11.2, 290, 'recibido', null, '',
    clienteUserId, 'Andrea Castillo',
    new Date(Date.now() - 18 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
    new Date(Date.now() - 18 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  );
  insertOrderItem.run(Number(o3.lastInsertRowid), prodIds[10], 'Leche Entera Fresca Leyde', 'LP-011', 2, 32, 0, 0, 64);
  insertOrderItem.run(Number(o3.lastInsertRowid), prodIds[11], 'Queso Semiseco Artesanal', 'LP-012', 1, 95, 0, 0, 95);
  insertOrderItem.run(Number(o3.lastInsertRowid), prodIds[4], 'Chocolate Oscuro Artesanal 70%', 'LP-005', 1, 65, 0, 0.15, 65);
  insertOrderItem.run(Number(o3.lastInsertRowid), prodIds[3], 'Tortrix Sal y Limón Familiar', 'LP-004', 1, 26, 0, 0.15, 26);

  // Order 4: Active Online Order assigned to driver ('en_camino')
  const o4 = insertOrder.run(
    'PED-2026-0144', 'online', Number(c2.lastInsertRowid), 'Roberto Morales', '+504 9940-1122', '05011985012934',
    'domicilio', 'Bo. El Centro, 2da Ave, Local 14', 'A dos cuadras del parque central', 'Entregar en caja del local',
    'Barrio El Centro / Casco Urbano', 35, 'efectivo', '', 500, 0,
    220, 0, 14.35, 255, 'en_camino', 5, 'Josué Paz',
    3, 'Mario Zelaya',
    new Date(Date.now() - 42 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
    new Date(Date.now() - 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  );
  insertOrderItem.run(Number(o4.lastInsertRowid), prodIds[13], 'Pechuga de Pollo Congelada', 'LP-014', 1, 115, 0, 0, 115);
  insertOrderItem.run(Number(o4.lastInsertRowid), prodIds[14], 'Helado Napolitano Familiar', 'LP-015', 1, 110, 0, 0.15, 110);

  // Initial inventory movements
  const insertMov = db.prepare(`
    INSERT INTO inventory_movements (product_id, type, quantity_delta, previous_stock, new_stock, reason, batch_expiry, user_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMov.run(prodIds[7], 'compra', 50, 10, 60, 'Compra confirmada FAC-PROV-00841', '2027-10-10', 'Elena Ramírez');
  insertMov.run(prodIds[6], 'venta_pos', -2, 30, 28, 'Venta presencial POS-2026-0141', null, 'Lucía Fernández');
  insertMov.run(prodIds[18], 'perdida_danado', -2, 2, 0, 'Empaques dañados por humedad en bodega', null, 'Elena Ramírez');

  // Initial audit log
  db.prepare(`
    INSERT INTO audit_logs (user_id, user_name, user_role, module, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(1, 'Carlos Mendoza', 'Administrador', 'Sistema', 'Inicialización', 'Base de datos centralizada inicializada con catálogo y configuración SAR.');
}

export function logAudit(
  user: { id?: number | null; name: string; role: string } | null,
  module: string,
  action: string,
  details: string
): void {
  db.prepare(`
    INSERT INTO audit_logs (user_id, user_name, user_role, module, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user?.id ?? null, user?.name || 'Sistema', user?.role || 'Sistema', module, action, details);
}

export function numberToLempirasWords(amount: number): string {
  const intPart = Math.floor(amount);
  const cents = Math.round((amount - intPart) * 100);
  const centsStr = String(cents).padStart(2, '0');

  if (intPart === 0) return `CERO LEMPIRAS CON ${centsStr}/100`;

  const units = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const teens = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const tens = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const hundreds = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  const convertHundreds = (n: number): string => {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let res = h > 0 ? hundreds[h] : '';
    if (rest > 0) {
      if (res) res += ' ';
      if (rest < 10) res += units[rest];
      else if (rest < 20) res += teens[rest - 10];
      else if (rest < 30 && rest > 20) res += 'VEINTI' + units[rest - 20];
      else {
        const t = Math.floor(rest / 10);
        const u = rest % 10;
        res += tens[t] + (u > 0 ? ' Y ' + units[u] : '');
      }
    }
    return res;
  };

  let words = '';
  const thousands = Math.floor(intPart / 1000);
  const rem = intPart % 1000;
  if (thousands > 0) {
    words += thousands === 1 ? 'MIL' : `${convertHundreds(thousands)} MIL`;
  }
  if (rem > 0) {
    if (words) words += ' ';
    words += convertHundreds(rem);
  }
  return `${words} LEMPIRAS CON ${centsStr}/100`;
}
