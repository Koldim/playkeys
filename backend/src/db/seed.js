import { pool } from "./pool.js";

const PRODUCTS = [
  ["STEAM-TOPUP-500", "Пополнение Steam 500 ₽", "topup", 500, "RUB", "assets/steam.png"],
  ["STEAM-TOPUP-1000", "Пополнение Steam 1000 ₽", "topup", 1000, "RUB", "assets/steam.png"],
  ["STEAM-TOPUP-2500", "Пополнение Steam 2500 ₽", "topup", 2500, "RUB", "assets/steam.png"],
  ["KEY-CS2-PRIME", "CS2 Prime Status ключ", "key", 1290, "RUB", "assets/cover.png"],
  ["KEY-GTA5", "GTA V ключ активации", "key", 1990, "RUB", "assets/gta5.png"],
  ["KEY-EFT", "Escape from Tarkov ключ", "key", 3490, "RUB", "assets/eft.png"],
  ["SUB-DISCORD-1M", "Discord Nitro 1 месяц", "subscription", 399, "RUB", "assets/discord.png"],
  ["SUB-YT-3M", "YouTube Premium 3 месяца", "subscription", 1490, "RUB", "assets/youtube.png"],
  ["SUB-SPOTIFY-1M", "Spotify Premium 1 месяц", "subscription", 299, "RUB", "assets/spotify.png"],
  ["GIFT-PSN-1000", "PlayStation Store карта 1000 ₽", "giftcard", 1000, "RUB", "assets/psn.png"],
  ["GIFT-XBOX-1500", "Xbox Gift Card 1500 ₽", "giftcard", 1500, "RUB", "assets/xbox.png"],
  ["GIFT-ROBLOX-800", "Roblox 800 Robux", "giftcard", 890, "RUB", "assets/roblox.png"],
];

const KEYS = [
  "LFXC-TNCS-BPCD",
  "P3EI-W8UO-9B4K",
  "FEL3-GUXN-TCCH",
  "YPLV-QK2Z-IUS5",
  "0K9E-P1FR-BY1U",
  "5LZV-UQ48-RXCZ",
  "X93K-NYAQ-GEC1",
  "EIO5-CQT5-35KO",
  "M58F-GIIR-VJAP",
  "NU8Y-SWYB-6252",
  "OODW-CCHF-MBAF",
  "DNA5-WFJM-NE49",
  "QRDD-MJ3F-A8TF",
  "TAT9-5ZJN-G1T2",
  "LI39-4330-ISMB",
  "BKJY-8Q79-8NHI",
  "HHW6-4RX2-DX62",
  "1RG2-L28O-O80G",
  "EF63-F39X-MTEA",
  "8XS7-P53H-JKIV",
  "JPE6-MQV6-P7ST",
  "SAPG-A2GR-0ULS",
  "T2DU-IJ1S-U16P",
  "WSSY-QTR7-Z57J",
  "U74E-EPCI-CY26",
  "FZXF-58H8-OR93",
  "FPSM-HLZA-TPAL",
  "WSC9-28DJ-B2JE",
  "P63J-F7UZ-DCYP",
  "C7W2-D4C5-QMT7",
  "JESI-DFBH-LK1K",
  "SGMA-JA0T-GR7D",
  "3PR4-OSY9-M3ZW",
  "OMBE-C0JF-D45Y",
  "KIKQ-FQJ8-9TI8",
  "LMAN-RSHS-AJDO",
  "BAKI-VT1X-Z5OL",
  "9F0X-B46W-03FS",
  "S423-V6YY-IBEM",
  "D4UW-WYRA-20ST",
  "XC0J-CJ0H-09RN",
  "RY1W-XCFJ-0KUA",
  "CJYY-YKSQ-QE6H",
  "97AQ-38QJ-H8HU",
  "FS8E-3S5Z-I6RA",
  "ARQK-FML4-A14E",
  "7Z6K-NO9V-MPJB",
  "D4K7-IJSG-N853",
  "W67T-ZB0Q-1XKB",
  "7EQM-K09J-XKUO",
];

const PROMOS = [
  ["WELCOME10", "percent", 10, null, 100],
  ["GG500", "amount", 500, "RUB", 20],
  ["LIMIT3", "percent", 25, null, 3],
  ["ONCEONLY", "percent", 50, null, 1],
];

export async function seed() {
  for (const p of PRODUCTS) {
    await pool.query(
      `INSERT INTO products (sku, name, type, price, currency, image)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sku) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         image = EXCLUDED.image`,
      p
    );
  }

  for (const code of KEYS) {
    await pool.query(
      `INSERT INTO keys (sku, code, status)
       VALUES ('KEY-CS2-PRIME', $1, 'available')
       ON CONFLICT (code) DO NOTHING`,
      [code]
    );
  }

  for (let i = 1; i <= 20; i++) {
    await pool.query(
      `INSERT INTO keys (sku, code, status)
       VALUES ('KEY-GTA5', $1, 'available')
       ON CONFLICT (code) DO NOTHING`,
      [`GTA5-SEED-${String(i).padStart(2, "0")}`]
    );
    await pool.query(
      `INSERT INTO keys (sku, code, status)
       VALUES ('KEY-EFT', $1, 'available')
       ON CONFLICT (code) DO NOTHING`,
      [`EFT-SEED-${String(i).padStart(2, "0")}`]
    );
  }

  for (const promo of PROMOS) {
    await pool.query(
      `INSERT INTO promocodes (code, type, value, currency, max_uses, used_count)
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (code) DO NOTHING`,
      promo
    );
  }

  await seedCatalog();
}

async function seedCatalog() {
  // Search catalog: avoid OFFER-* with type=key and empty key pool.
  await pool.query(
    `UPDATE products
     SET type = 'giftcard'
     WHERE sku LIKE 'OFFER-%' AND type = 'key'`
  );

  const count = await pool.query(`SELECT count(*)::int AS n FROM products WHERE sku LIKE 'OFFER-%'`);
  if (count.rows[0].n >= 2500) return;

  const titles = ["CS2", "GTA V", "EFT", "Dota 2", "Valorant", "Roblox", "Steam", "Xbox", "PSN", "Nitro"];
  const types = ["giftcard", "subscription", "topup"];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 1; i <= 2500; i++) {
      const sku = `OFFER-${String(i).padStart(4, "0")}`;
      const type = types[i % types.length];
      const name = `${titles[i % titles.length]} оффер ${i}`;
      const price = 199 + (i % 80) * 10;
      await client.query(
        `INSERT INTO products (sku, name, type, price, currency, image, available)
         VALUES ($1, $2, $3, $4, 'RUB', 'assets/cover.png', true)
         ON CONFLICT (sku) DO NOTHING`,
        [sku, name, type, price]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  seed()
    .then(() => {
      console.log("seed complete");
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
