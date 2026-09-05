'use strict';
/**
 * SEVA MARKET INDIA — storage layer.
 *
 * SQLite through the Node core driver (node:sqlite). One file, no service to
 * run, no external dependency. The public interface is deliberately small so
 * the same calls can later be backed by Postgres/Supabase without touching
 * the API layer.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed-data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'customer',
  city          TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  tagline    TEXT DEFAULT '',
  base_price INTEGER DEFAULT 0,
  popular    INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL,
  name         TEXT NOT NULL,
  base_price   INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 60
);
CREATE TABLE IF NOT EXISTS cities (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  state TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS providers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER,
  business_name    TEXT NOT NULL,
  category_id      INTEGER NOT NULL,
  city             TEXT NOT NULL,
  area             TEXT DEFAULT '',
  headline         TEXT DEFAULT '',
  bio              TEXT DEFAULT '',
  experience_years INTEGER DEFAULT 0,
  verified         INTEGER DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',
  rating           REAL DEFAULT 0,
  rating_count     INTEGER DEFAULT 0,
  jobs_done        INTEGER DEFAULT 0,
  price_from       INTEGER DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_services (
  provider_id  INTEGER NOT NULL,
  service_id   INTEGER NOT NULL,
  price        INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 60,
  PRIMARY KEY (provider_id, service_id)
);
CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  service_id  INTEGER NOT NULL,
  date        TEXT NOT NULL,
  slot        TEXT NOT NULL,
  address     TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'requested',
  price       INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id   INTEGER UNIQUE NOT NULL,
  provider_id  INTEGER NOT NULL,
  customer_id  INTEGER NOT NULL,
  rating       INTEGER NOT NULL,
  comment      TEXT DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(category_id);
CREATE INDEX IF NOT EXISTS idx_providers_city ON providers(city);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
`;

function rowsToObjects(rows) {
  return rows.map((row) => Object.assign({}, row));
}

class Db {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.seedIfEmpty();
  }

  /* ------------------------------------------------------------ primitives */
  exec(sql, params = []) { return this.db.prepare(sql).run(...params); }
  run(sql, params = []) { return this.exec(sql, params); }
  all(sql, params = []) { return rowsToObjects(this.db.prepare(sql).all(...params)); }
  get(sql, params = []) {
    const row = this.db.prepare(sql).get(...params);
    return row ? Object.assign({}, row) : null;
  }

  /* ----------------------------------------------------------------- seed */
  seedIfEmpty() {
    const count = this.get('SELECT COUNT(*) AS n FROM categories');
    if (count && count.n > 0) return;
    const now = Date.now();

    for (const city of seed.CITIES) this.exec('INSERT INTO cities (name, state) VALUES (?, ?)', [city.name, city.state]);

    for (const category of seed.CATEGORIES) {
      const info = this.exec(
        'INSERT INTO categories (slug, name, tagline, base_price, popular) VALUES (?, ?, ?, ?, ?)',
        [category.slug, category.name, category.tagline, category.base_price, category.popular]
      );
      const categoryId = Number(info.lastInsertRowid);
      for (const [name, price, minutes] of seed.SERVICES[category.slug] || []) {
        this.exec('INSERT INTO services (category_id, name, base_price, duration_min) VALUES (?, ?, ?, ?)', [categoryId, name, price, minutes]);
      }
    }

    for (const entry of seed.PROVIDERS) {
      const [business, city, area, categorySlug, experience, headline, verified] = entry;
      const category = this.get('SELECT id FROM categories WHERE slug = ?', [categorySlug]);
      if (!category) continue;
      const services = this.all('SELECT id, base_price FROM services WHERE category_id = ?', [category.id]);
      const priceFrom = services.length ? Math.min(...services.map((s) => s.base_price)) : 0;
      const info = this.exec(
        `INSERT INTO providers (user_id, business_name, category_id, city, area, headline, bio,
           experience_years, verified, status, rating, rating_count, jobs_done, price_from, created_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, 0, ?, ?, ?)`,
        [
          business, category.id, city, area, headline,
          `${business} has served homes and businesses in ${city} for ${experience} years. ` +
            'Trained team, transparent pricing and a rework guarantee on every completed job.',
          experience, verified ? 1 : 0, 30 + Math.floor(Math.random() * 220), priceFrom, now
        ]
      );
      const providerId = Number(info.lastInsertRowid);
      for (const service of services) {
        // Slight, deterministic-looking variation around the catalogue price.
        const jitter = Math.round(service.base_price * (0.9 + ((providerId * 7 + service.id * 13) % 20) / 100));
        this.exec('INSERT INTO provider_services (provider_id, service_id, price, duration_min) VALUES (?, ?, ?, ?)', [
          providerId, service.id, jitter, 60
        ]);
      }

      const reviewCount = 3 + ((providerId * 3) % 4); // 3 – 6 reviews
      for (let i = 0; i < reviewCount; i++) {
        const person = seed.REVIEWERS[(providerId * 2 + i) % seed.REVIEWERS.length];
        const rating = Math.min(5, Math.max(3, person[1] + ((providerId + i) % 3 === 0 ? -1 : 0)));
        this.exec(
          'INSERT INTO reviews (booking_id, provider_id, customer_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [-(providerId * 100 + i), providerId, 0, rating, person[2], now - i * 86400000 * 3]
        );
      }
      this.refreshRating(providerId);
    }
  }

  refreshRating(providerId) {
    const row = this.get('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE provider_id = ?', [providerId]);
    const count = row ? row.n : 0;
    const avg = row && row.avg ? row.avg : 0;
    this.exec('UPDATE providers SET rating = ?, rating_count = ? WHERE id = ?', [Math.round(avg * 10) / 10, count, providerId]);
  }

  /* -------------------------------------------------------------- catalogue */
  categories() {
    return this.all('SELECT * FROM categories ORDER BY popular DESC, name ASC');
  }

  categoryBySlug(slug) {
    return this.get('SELECT * FROM categories WHERE slug = ?', [slug]);
  }

  cities() {
    return this.all('SELECT * FROM cities ORDER BY name ASC');
  }

  servicesForCategory(categoryId) {
    return this.all('SELECT * FROM services WHERE category_id = ? ORDER BY base_price ASC', [categoryId]);
  }

  /**
   * Provider search. All filters are optional and every value is bound.
   */
  searchProviders(options = {}) {
    const where = ["p.status = 'approved'"];
    const params = [];
    if (options.category) {
      where.push('c.slug = ?');
      params.push(options.category);
    }
    if (options.city) {
      where.push('p.city = ?');
      params.push(options.city);
    }
    if (options.q) {
      where.push('(p.business_name LIKE ? OR p.headline LIKE ? OR c.name LIKE ? OR p.area LIKE ?)');
      const like = `%${String(options.q).trim()}%`;
      params.push(like, like, like, like);
    }
    if (options.min_rating) {
      where.push('p.rating >= ?');
      params.push(Number(options.min_rating));
    }
    if (options.verified) {
      where.push('p.verified = 1');
    }
    if (options.max_price) {
      where.push('p.price_from <= ?');
      params.push(Number(options.max_price));
    }

    const order = {
      rating: 'p.rating DESC, p.rating_count DESC',
      price: 'p.price_from ASC, p.rating DESC',
      experience: 'p.experience_years DESC, p.rating DESC',
      newest: 'p.created_at DESC'
    }[String(options.sort || 'rating')] || 'p.rating DESC, p.rating_count DESC';

    const page = Math.max(1, Number(options.page) || 1);
    const perPage = Math.min(48, Math.max(1, Number(options.per_page) || 12));
    const total = this.get(`SELECT COUNT(*) AS n FROM providers p JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`, params).n;

    const items = this.all(
      `SELECT p.id, p.business_name, p.city, p.area, p.headline, p.experience_years, p.verified,
              p.rating, p.rating_count, p.jobs_done, p.price_from,
              c.slug AS category_slug, c.name AS category_name
         FROM providers p JOIN categories c ON c.id = p.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    );

    return { items, total, page, per_page: perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  providerDetail(id) {
    const provider = this.get(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.tagline AS category_tagline
         FROM providers p JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?`,
      [id]
    );
    if (!provider) return null;
    provider.services = this.all(
      `SELECT s.id, s.name, s.base_price, s.duration_min,
              COALESCE(ps.price, s.base_price) AS price
         FROM provider_services ps JOIN services s ON s.id = ps.service_id
        WHERE ps.provider_id = ?
        ORDER BY price ASC`,
      [id]
    );
    provider.reviews = this.all(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS customer_name
         FROM reviews r LEFT JOIN users u ON u.id = r.customer_id
        WHERE r.provider_id = ?
        ORDER BY r.created_at DESC
        LIMIT 20`,
      [id]
    );
    return provider;
  }

  providerByUser(userId) {
    return this.get('SELECT * FROM providers WHERE user_id = ?', [userId]);
  }

  listProviders(options = {}) {
    const where = [];
    const params = [];
    if (options.status) { where.push('p.status = ?'); params.push(options.status); }
    if (options.city) { where.push('p.city = ?'); params.push(options.city); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.all(
      `SELECT p.id, p.business_name, p.city, p.area, p.status, p.verified, p.rating, p.rating_count,
              p.jobs_done, p.price_from, p.experience_years, c.name AS category_name
         FROM providers p JOIN categories c ON c.id = p.category_id
         ${clause}
        ORDER BY p.id DESC
        LIMIT 200`,
      params
    );
  }

  /* ---------------------------------------------------------------- users */
  userByEmail(email) {
    return this.get('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  }

  userById(id) {
    return this.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  createUser(row) {
    const info = this.exec(
      `INSERT INTO users (email, password_hash, salt, name, phone, role, city, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [row.email, row.password_hash, row.salt, row.name, row.phone || '', row.role || 'customer', row.city || '', Date.now()]
    );
    return Number(info.lastInsertRowid);
  }

  /* ------------------------------------------------------------- providers */
  createProvider(row) {
    const info = this.exec(
      `INSERT INTO providers (user_id, business_name, category_id, city, area, headline, bio,
         experience_years, verified, status, price_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
      [
        row.user_id, row.business_name, row.category_id, row.city, row.area || '',
        row.headline || '', row.bio || '', Number(row.experience_years) || 0,
        Number(row.price_from) || 0, Date.now()
      ]
    );
    const id = Number(info.lastInsertRowid);
    for (const service of this.servicesForCategory(row.category_id)) {
      this.exec('INSERT OR REPLACE INTO provider_services (provider_id, service_id, price, duration_min) VALUES (?, ?, ?, ?)', [
        id, service.id, service.base_price, service.duration_min
      ]);
    }
    return id;
  }

  updateProvider(id, patch) {
    const allowed = ['business_name', 'city', 'area', 'headline', 'bio', 'experience_years', 'price_from', 'status', 'verified', 'category_id'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
    if (!sets.length) return;
    params.push(id);
    this.exec(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  /* -------------------------------------------------------------- bookings */
  priceFor(providerId, serviceId) {
    const row = this.get(
      'SELECT COALESCE(ps.price, s.base_price) AS price FROM services s LEFT JOIN provider_services ps ON ps.service_id = s.id AND ps.provider_id = ? WHERE s.id = ?',
      [providerId, serviceId]
    );
    return row ? row.price : 0;
  }

  createBooking(row) {
    const now = Date.now();
    const info = this.exec(
      `INSERT INTO bookings (customer_id, provider_id, service_id, date, slot, address, notes, status, price, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`,
      [row.customer_id, row.provider_id, row.service_id, row.date, row.slot, row.address || '', row.notes || '', row.price, now, now]
    );
    return Number(info.lastInsertRowid);
  }

  bookingById(id) {
    return this.get(
      `SELECT b.*, p.business_name, p.city AS provider_city, s.name AS service_name, s.duration_min,
              u.name AS customer_name, u.phone AS customer_phone
         FROM bookings b
         JOIN providers p ON p.id = b.provider_id
         JOIN services s ON s.id = b.service_id
         JOIN users u ON u.id = b.customer_id
        WHERE b.id = ?`,
      [id]
    );
  }

  bookingsForCustomer(customerId) {
    return this.all(
      `SELECT b.*, p.business_name, p.city AS provider_city, p.area AS provider_area, s.name AS service_name,
              (SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id) AS reviewed
         FROM bookings b JOIN providers p ON p.id = b.provider_id JOIN services s ON s.id = b.service_id
        WHERE b.customer_id = ?
        ORDER BY b.created_at DESC`,
      [customerId]
    );
  }

  bookingsForProvider(providerId) {
    return this.all(
      `SELECT b.*, s.name AS service_name, u.name AS customer_name
         FROM bookings b JOIN services s ON s.id = b.service_id JOIN users u ON u.id = b.customer_id
        WHERE b.provider_id = ?
        ORDER BY CASE b.status WHEN 'requested' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, b.created_at DESC`,
      [providerId]
    );
  }

  setBookingStatus(id, status) {
    this.exec('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
    if (status === 'completed') {
      const booking = this.get('SELECT provider_id FROM bookings WHERE id = ?', [id]);
      if (booking) {
        this.exec('UPDATE providers SET jobs_done = jobs_done + 1 WHERE id = ?', [booking.provider_id]);
      }
    }
  }

  addReview(row) {
    const existing = this.get('SELECT id FROM reviews WHERE booking_id = ?', [row.booking_id]);
    if (existing) return null;
    const info = this.exec(
      'INSERT INTO reviews (booking_id, provider_id, customer_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.booking_id, row.provider_id, row.customer_id, row.rating, row.comment || '', Date.now()]
    );
    this.refreshRating(row.provider_id);
    return Number(info.lastInsertRowid);
  }

  /* ----------------------------------------------------------------- admin */
  stats() {
    const one = (sql, params = []) => this.get(sql, params) || {};
    return {
      customers: one("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").n || 0,
      providers_approved: one("SELECT COUNT(*) AS n FROM providers WHERE status = 'approved'").n || 0,
      providers_pending: one("SELECT COUNT(*) AS n FROM providers WHERE status = 'pending'").n || 0,
      bookings: one('SELECT COUNT(*) AS n FROM bookings').n || 0,
      bookings_requested: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'").n || 0,
      bookings_completed: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed'").n || 0,
      reviews: one('SELECT COUNT(*) AS n FROM reviews').n || 0,
      revenue: one("SELECT COALESCE(SUM(price),0) AS n FROM bookings WHERE status = 'completed'").n || 0,
      categories: one('SELECT COUNT(*) AS n FROM categories').n || 0
    };
  }

  recentBookings(limit = 12) {
    return this.all(
      `SELECT b.id, b.status, b.date, b.slot, b.price, u.name AS customer_name, p.business_name, s.name AS service_name
         FROM bookings b
         JOIN users u ON u.id = b.customer_id
         JOIN providers p ON p.id = b.provider_id
         JOIN services s ON s.id = b.service_id
        ORDER BY b.created_at DESC
        LIMIT ?`,
      [limit]
    );
  }

  topCategories() {
    return this.all(
      `SELECT c.name, c.slug, COUNT(b.id) AS bookings
         FROM categories c LEFT JOIN providers p ON p.category_id = c.id
         LEFT JOIN bookings b ON b.provider_id = p.id
        GROUP BY c.id
        ORDER BY bookings DESC, c.name ASC
        LIMIT 6`
    );
  }

  close() {
    try { this.db.close(); } catch (_) { /* already closed */ }
  }
}

module.exports = { Db, SCHEMA };
