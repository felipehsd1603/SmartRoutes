const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Get all posts
router.get('/posts', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM posts ORDER BY published_at DESC");
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get latest posts for specific categories
router.get('/posts/category/:category', async (req, res) => {
    try {
        const category = req.params.category;
        const result = await db.query("SELECT * FROM posts WHERE category = $1 ORDER BY published_at DESC LIMIT 6", [category]);
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
        const result = await db.query("SELECT id, title, brand, category, image_url, price_cents, retail_price_cents, coupon, affiliate_url, badge, position FROM offers WHERE is_active=1 ORDER BY position ASC, published_at DESC");
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Click tracking
router.post('/track', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => {
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

module.exports = router;

