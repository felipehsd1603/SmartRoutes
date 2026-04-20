const express = require('express');
const router = express.Router();
const db = require('../database/db');
const webpush = require('web-push');

// Web Push (VAPID) — opcional, só ativa se as envs estiverem setadas
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@sdmlinks.com.br';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Rate limiter simples para /track
const trackRateMap = new Map();
function checkTrackRate(ip) {
    const now = Date.now();
    const entry = trackRateMap.get(ip);
    if (!entry || now > entry.resetAt) {
        trackRateMap.set(ip, { count: 1, resetAt: now + 60000 });
        return true;
    }
    if (entry.count >= 60) return false;
    entry.count++;
    return true;
}

// Rate limiter para /notify-subscribe (10 req/min/IP)
const notifyRateMap = new Map();
function checkNotifyRate(ip) {
    const now = Date.now();
    const entry = notifyRateMap.get(ip);
    if (!entry || now > entry.resetAt) {
        notifyRateMap.set(ip, { count: 1, resetAt: now + 60000 });
        return true;
    }
    if (entry.count >= 10) return false;
    entry.count++;
    return true;
}

// Ads config (public)
router.get('/ads-config', async (req, res) => {
    try {
        const result = await db.query("SELECT key, value FROM settings WHERE key LIKE 'ads_%'");
        const config = {};
        for (const row of result.rows) {
            config[row.key] = row.value;
        }
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ data: config });
    } catch (err) {
        res.json({ data: { ads_enabled: 'false' } });
    }
});

// Get banner config (public)
router.get('/banner', async (req, res) => {
    try {
        const result = await db.query("SELECT key, value FROM settings WHERE key LIKE 'banner_%'");
        const config = {};
        for (const row of result.rows) {
            config[row.key] = row.value;
        }
        res.json({ data: config });
    } catch (err) {
        res.json({ data: { banner_active: 'false' } });
    }
});

// Upcoming releases para o calendário (deve ficar ANTES de /posts/:slug)
router.get('/posts/upcoming', async (req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=60');
        const result = await db.query(`
            SELECT id, slug, title, brand, model, image_url, price_cents, release_date, published_at
            FROM posts
            WHERE release_date IS NOT NULL
            ORDER BY
                CASE WHEN release_date >= CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
                release_date ASC
            LIMIT 60
        `);
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get posts with pagination (for infinite scroll)
router.get('/posts', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 12, 48);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const filter = req.query.brand || req.query.filter || null;

        let sql, params;
        if (filter) {
            sql = `SELECT p.id, p.title, p.slug, p.category, p.brand, p.model, p.image_url, p.cover_image_url, p.hero_color,
                          p.price_cents, p.excerpt, p.is_pinned, p.is_sponsored, p.published_at, p.release_date,
                          COALESCE(ns.cnt, 0) AS notify_count
                   FROM posts p
                   LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM notify_subscriptions GROUP BY post_id) ns ON ns.post_id = p.id
                   WHERE p.published_at <= CURRENT_TIMESTAMP
                     AND (p.brand ILIKE $1 OR p.category ILIKE $1)
                   ORDER BY p.is_pinned DESC, p.published_at DESC LIMIT $2 OFFSET $3`;
            params = [filter, limit, offset];
        } else {
            sql = `SELECT p.id, p.title, p.slug, p.category, p.brand, p.model, p.image_url, p.cover_image_url, p.hero_color,
                          p.price_cents, p.excerpt, p.is_pinned, p.is_sponsored, p.published_at, p.release_date,
                          COALESCE(ns.cnt, 0) AS notify_count
                   FROM posts p
                   LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM notify_subscriptions GROUP BY post_id) ns ON ns.post_id = p.id
                   WHERE p.published_at <= CURRENT_TIMESTAMP
                   ORDER BY p.is_pinned DESC, p.published_at DESC LIMIT $1 OFFSET $2`;
            params = [limit, offset];
        }

        const result = await db.query(sql, params);
        const countSql = filter
            ? "SELECT COUNT(*) FROM posts WHERE published_at <= CURRENT_TIMESTAMP AND (brand ILIKE $1 OR category ILIKE $1)"
            : "SELECT COUNT(*) FROM posts WHERE published_at <= CURRENT_TIMESTAMP";
        const total = await db.query(countSql, filter ? [filter] : []);
        res.set('Cache-Control', 'public, max-age=30');
        res.json({ data: result.rows, total: parseInt(total.rows[0].count), offset, limit });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Instant search
router.get('/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ data: [] });

        const term = `%${q}%`;
        const result = await db.query(
            `SELECT id, title, slug, category, brand, model, image_url, price_cents, excerpt
             FROM posts
             WHERE published_at <= CURRENT_TIMESTAMP
               AND (title ILIKE $1 OR brand ILIKE $1 OR model ILIKE $1 OR tags ILIKE $1 OR category ILIKE $1)
             ORDER BY is_pinned DESC, published_at DESC
             LIMIT 8`,
            [term]
        );
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get latest posts for specific categories
router.get('/posts/category/:category', async (req, res) => {
    try {
        const category = req.params.category;
        const result = await db.query("SELECT * FROM posts WHERE category = $1 AND published_at <= CURRENT_TIMESTAMP ORDER BY published_at DESC LIMIT 6", [category]);
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public post detail by slug (post + images + stores + related)
router.get('/posts/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        const postResult = await db.query("SELECT * FROM posts WHERE slug = $1", [slug]);
        const post = postResult.rows[0];

        if (!post) return res.status(404).json({ error: 'Post não encontrado' });

        const [images, stores, related] = await Promise.all([
            db.query("SELECT id, url, alt, position FROM post_images WHERE post_id = $1 ORDER BY position ASC, id ASC", [post.id]),
            db.query(`SELECT ps.id, ps.url, ps.release_date, ps.status, s.name AS store_name
                     FROM post_stores ps
                     JOIN stores s ON s.id = ps.store_id
                     WHERE ps.post_id = $1
                     ORDER BY ps.id ASC`, [post.id]),
            db.query("SELECT id, name, image_url, store_url, position FROM related_products WHERE post_id = $1 ORDER BY position ASC, id ASC", [post.id])
        ]);

        res.json({ data: { 
            ...post, 
            images: images.rows, 
            stores: stores.rows, 
            related_products: related.rows 
        } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Related posts (same brand, diferente id)
router.get('/posts/:slug/related', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 4, 10);
        const postResult = await db.query("SELECT id, brand, model FROM posts WHERE slug = $1", [req.params.slug]);
        const post = postResult.rows[0];

        if (!post) return res.status(404).json({ error: 'Post não encontrado' });

        const brand = post.brand;
        const sql = brand
            ? `SELECT id, slug, title, brand, model, image_url, price_cents, release_date
               FROM posts
               WHERE brand = $1 AND id != $2 AND slug IS NOT NULL
               ORDER BY published_at DESC LIMIT $3`
            : `SELECT id, slug, title, brand, model, image_url, price_cents, release_date
               FROM posts
               WHERE id != $1 AND slug IS NOT NULL
               ORDER BY published_at DESC LIMIT $2`;
        
        const params = brand ? [brand, post.id, limit] : [post.id, limit];
        const result = await db.query(sql, params);
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Offers públicas (cards "Ofertas de hoje")
router.get('/offers', async (req, res) => {
    try {
        const result = await db.query("SELECT id, title, brand, category, image_url, price_cents, retail_price_cents, coupon, affiliate_url, badge, position FROM offers WHERE is_active=1 AND published_at <= CURRENT_TIMESTAMP ORDER BY position ASC, published_at DESC");
        res.set('Cache-Control', 'public, max-age=60');
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cupons ativos (seção "Usa agora, economiza hoje")
router.get('/coupons', async (req, res) => {
    try {
        const result = await db.query("SELECT id, code, brand, discount_label, url, variant, position FROM coupons WHERE is_active=1 AND published_at <= CURRENT_TIMESTAMP ORDER BY position ASC, published_at DESC");
        res.set('Cache-Control', 'public, max-age=60');
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Parcerias ativas (banners de parceria no home)
router.get('/partnerships', async (req, res) => {
    try {
        const result = await db.query("SELECT id, title, subtitle, badge, highlight, cta_label, cta_url, position FROM partnerships WHERE is_active=1 AND published_at <= CURRENT_TIMESTAMP ORDER BY position ASC, published_at DESC");
        res.set('Cache-Control', 'public, max-age=60');
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Like / Heat
router.post('/posts/:id/like', async (req, res) => {
    try {
        const result = await db.query("UPDATE posts SET likes = likes + 1 WHERE id = $1 RETURNING likes", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Post não encontrado' });
        res.json({ data: { likes: result.rows[0].likes } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Click tracking
router.post('/track', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (!checkTrackRate(ip)) return res.status(429).end();

    let payload = {};
    try {
        payload = typeof req.body === 'string' && req.body ? JSON.parse(req.body) : (req.body || {});
    } catch { payload = {}; }

    const label = String(payload.label || '').slice(0, 64);
    if (!label) return res.status(204).end();

    const href = payload.href ? String(payload.href).slice(0, 512) : null;
    const referrer = req.get('referer') ? req.get('referer').slice(0, 512) : null;
    const ua = req.get('user-agent') ? req.get('user-agent').slice(0, 256) : null;

    try {
        await db.query(
            "INSERT INTO clicks (label, href, referrer, user_agent) VALUES ($1, $2, $3, $4)",
            [label, href, referrer, ua]
        );
    } catch {}
    res.status(204).end();
});

// Chave pública VAPID para o frontend usar no pushManager.subscribe
router.get('/vapid-public-key', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('text/plain').send(VAPID_PUBLIC);
});

// Contador de "me avise" por post (prova social)
router.get('/posts/:slug/notify-count', async (req, res) => {
    try {
        const postResult = await db.query("SELECT id FROM posts WHERE slug = $1", [req.params.slug]);
        if (!postResult.rows[0]) return res.json({ data: { count: 0 } });
        const result = await db.query(
            "SELECT COUNT(*) AS count FROM notify_subscriptions WHERE post_id = $1",
            [postResult.rows[0].id]
        );
        res.set('Cache-Control', 'public, max-age=30');
        res.json({ data: { count: parseInt(result.rows[0].count) } });
    } catch (err) {
        res.json({ data: { count: 0 } });
    }
});

// Cadastro de "me avise quando lançar"
router.post('/notify-subscribe', async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (!checkNotifyRate(ip)) return res.status(429).json({ error: 'Muitas requisições, tente mais tarde' });

    try {
        const { slug, channel, subscription, email } = req.body || {};
        if (!slug || !channel) return res.status(400).json({ error: 'slug e channel obrigatórios' });
        if (!['push', 'email'].includes(channel)) return res.status(400).json({ error: 'channel inválido' });

        const postResult = await db.query("SELECT id FROM posts WHERE slug = $1", [slug]);
        if (!postResult.rows[0]) return res.status(404).json({ error: 'Post não encontrado' });
        const postId = postResult.rows[0].id;

        let endpoint, p256dh = null, auth = null;
        if (channel === 'push') {
            if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
                return res.status(400).json({ error: 'subscription inválida' });
            }
            endpoint = String(subscription.endpoint).slice(0, 512);
            p256dh = String(subscription.keys.p256dh).slice(0, 256);
            auth = String(subscription.keys.auth).slice(0, 64);
        } else {
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'email inválido' });
            }
            endpoint = String(email).toLowerCase().slice(0, 256);
        }

        await db.query(
            `INSERT INTO notify_subscriptions (post_id, channel, endpoint, p256dh, auth)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (post_id, channel, endpoint) DO NOTHING`,
            [postId, channel, endpoint, p256dh, auth]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

