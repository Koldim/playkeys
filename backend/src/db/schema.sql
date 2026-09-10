CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup', 'key', 'subscription', 'giftcard')),
  price INTEGER NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'RUB',
  image TEXT,
  available BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES products(sku),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created',
    'paid',
    'delivering',
    'delivered',
    'payment_failed',
    'out_of_stock',
    'delivery_failed',
    'hold_expired'
  )),
  key_code TEXT,
  promocode TEXT,
  error TEXT,
  hold_expires_at TIMESTAMPTZ,
  client_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  delivering_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS keys (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES products(sku),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'delivered')),
  order_id TEXT REFERENCES orders(id),
  reserved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS keys_one_order
  ON keys (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS keys_available_sku
  ON keys (sku, id)
  WHERE status = 'available';

ALTER TABLE products ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE keys ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_request_id_uidx
  ON orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'created',
  'paid',
  'delivering',
  'delivered',
  'payment_failed',
  'out_of_stock',
  'delivery_failed',
  'hold_expired'
));

CREATE INDEX IF NOT EXISTS products_name_lower ON products (lower(name));
CREATE INDEX IF NOT EXISTS products_type ON products (type);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payment_events_pending_order
  ON payment_events (order_id)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS delivery_requests (
  request_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  supplier TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error', 'timeout')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promocodes (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('percent', 'amount')),
  value INTEGER NOT NULL,
  currency TEXT,
  max_uses INTEGER NOT NULL CHECK (max_uses >= 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0)
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  code TEXT NOT NULL REFERENCES promocodes(code),
  order_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, order_id)
);
