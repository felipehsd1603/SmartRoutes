const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('../database/db');
const { createClient } = require('@supabase/supabase-js');

// Supabase client initialization
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Memory storage for Multer (since we'll stream to Supabase)
const upload = multer({ storage: multer.memoryStorage() });
const uploadRich = upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'gallery', maxCount: 20 },
    { name: 'related_images', maxCount: 10 }
]);

// --- Supabase Storage Helper ---
async function uploadToSupabase(file) {
    if (!file) return null;
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`;
    const { data, error } = await supabase.storage
        .from('images')
        .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });

    if (error) {
        console.error('Supabase Upload Error:', error);
        throw error;
    }

    // Return the public URL
    return `${process.env.SUPABASE_URL}/storage/v1/object/public/images/${fileName}`;
}

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/admin/login');
};

// --- Helpers ---
function slugify(t) {
    return String(t || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'post';
}

async function ensureUniqueSlug(base, excludeId) {
    let attempt = base, n = 1;
    while (true) {
        const sql = excludeId ? "SELECT id FROM posts WHERE slug=$1 AND id!=$2" : "SELECT id FROM posts WHERE slug=$1";
        const params = excludeId ? [attempt, excludeId] : [attempt];
        const res = await db.query(sql, params);
        if (res.rows.length === 0) return attempt;
        attempt = `${base}-${++n}`;
    }
}

function parseJSONField(raw) {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

function intOrNull(v) {
    if (v === '' || v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
}

function priceToCents(v) {
    if (v === '' || v == null) return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
}

async function collectRichPayload(req) {
    const b = req.body || {};
    const heroFile = req.files?.image?.[0];
    const galleryFiles = req.files?.gallery || [];
    const relatedFiles = req.files?.related_images || [];

    // Upload hero image to Supabase
    let heroUrl = b.image_url || null;
    if (heroFile) {
        heroUrl = await uploadToSupabase(heroFile);
    }

    // Upload gallery images to Supabase
    const galleryUrls = [];
    for (const f of galleryFiles) {
        const url = await uploadToSupabase(f);
        if (url) galleryUrls.push(url);
    }

    // Upload related images to Supabase
    const uploadedRelatedUrls = [];
    for (const f of relatedFiles) {
        uploadedRelatedUrls.push(await uploadToSupabase(f));
    }

    return {
        title: String(b.title || '').trim(),
        category: String(b.category || '').trim(),
        content: b.content || null,
        brand: b.brand || null,
        model: b.model || null,
        sku: b.sku || null,
        color: b.color || null,
        price_cents: priceToCents(b.price),
        retail_price_cents: priceToCents(b.retail_price),
        release_date: b.release_date || null,
        excerpt: b.excerpt || null,
        author: b.author || null,
        tags: b.tags || null,
        published_at: b.published_at || null, 
        is_pinned: b.is_pinned === 'true' || b.is_pinned === '1' || b.is_pinned === true ? 1 : 0,
        is_sponsored: b.is_sponsored === 'true' || b.is_sponsored === '1' || b.is_sponsored === true ? 1 : 0,
        hero_url: heroUrl,
        gallery_urls: galleryUrls,
        stores: parseJSONField(b.stores),
        related: parseJSONField(b.related),
        related_uploaded_urls: uploadedRelatedUrls
    };
}

async function replaceChildren(postId, payload) {
    await db.query("DELETE FROM post_images WHERE post_id=$1", [postId]);
    await db.query("DELETE FROM post_stores WHERE post_id=$1", [postId]);
    await db.query("DELETE FROM related_products WHERE post_id=$1", [postId]);

    for (const [i, url] of payload.gallery_urls.entries()) {
        await db.query("INSERT INTO post_images (post_id, url, position) VALUES ($1, $2, $3)", [postId, url, i]);
    }

    for (const s of payload.stores) {
        const storeId = intOrNull(s.store_id);
        if (!storeId || !s.url) continue;
        await db.query("INSERT INTO post_stores (post_id, store_id, url, release_date, status) VALUES ($1, $2, $3, $4, $5)", 
            [postId, storeId, s.url, s.release_date || null, s.status || 'available_now']);
    }

    for (const [i, r] of payload.related.entries()) {
        let imageUrl = r.image_url || null;
        const idx = intOrNull(r.image_index);
        if (idx != null && payload.related_uploaded_urls[idx]) {
            imageUrl = payload.related_uploaded_urls[idx];
        }
        if (!imageUrl) continue;
        await db.query("INSERT INTO related_products (post_id, name, image_url, store_url, position) VALUES ($1, $2, $3, $4, $5)", 
            [postId, r.name || null, imageUrl, r.store_url || null, i]);
    }
}

// --- Pages ---
router.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/login.html'));
});

// --- Auth ---
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`Tentativa de login para o usuário: ${username}`);
        
        const result = await db.query("SELECT * FROM admins WHERE username = $1", [username]);
        const row = result.rows[0];

        if (!row) {
            console.warn(`Usuário ${username} não encontrado no banco.`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const match = await bcrypt.compare(password, row.password);
        if (match) {
            console.log(`Login bem-sucedido para: ${username}`);
            req.session.userId = row.id;
            // Garantir que a sessão seja salva antes de responder
            req.session.save((err) => {
                if (err) {
                    console.error('Erro ao salvar sessão:', err);
                    return res.status(500).json({ error: 'Erro de sessão' });
                }
                res.json({ success: true });
            });
        } else {
            console.warn(`Senha incorreta para o usuário: ${username}`);
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (err) {
        console.error('Erro no processo de login:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- Stores ---
router.get('/stores', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT id, name FROM stores ORDER BY name ASC");
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Posts ---
router.get('/posts/:id', isAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const postResult = await db.query("SELECT * FROM posts WHERE id=$1", [id]);
        const post = postResult.rows[0];
        if (!post) return res.status(404).json({ error: 'Post não encontrado' });

        const [images, stores, related] = await Promise.all([
            db.query("SELECT id,url,alt,position FROM post_images WHERE post_id=$1 ORDER BY position", [id]),
            db.query(`SELECT ps.id, ps.store_id, ps.url, ps.release_date, ps.status, s.name AS store_name
                FROM post_stores ps JOIN stores s ON s.id=ps.store_id WHERE post_id=$1 ORDER BY ps.id`, [id]),
            db.query("SELECT id,name,image_url,store_url,position FROM related_products WHERE post_id=$1 ORDER BY position", [id])
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

router.post('/posts', isAuthenticated, uploadRich, async (req, res) => {
    try {
        const p = await collectRichPayload(req);
        if (!p.title || !p.category) return res.status(400).json({ error: 'title e category obrigatórios' });

        const slug = await ensureUniqueSlug(slugify(p.title), null);
        const result = await db.query(`INSERT INTO posts (
            title, category, image_url, content, slug, brand, model, sku, color,
            price_cents, retail_price_cents, release_date, excerpt, author, tags, is_pinned, is_sponsored
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
            [p.title, p.category, p.hero_url, p.content, slug, p.brand, p.model, p.sku, p.color,
             p.price_cents, p.retail_price_cents, p.release_date, p.excerpt, p.author, p.tags, p.is_pinned, p.is_sponsored]);
        
        const postId = result.rows[0].id;
        await replaceChildren(postId, p);
        res.json({ success: true, id: postId, slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/posts/:id', isAuthenticated, uploadRich, async (req, res) => {
    try {
        const id = req.params.id;
        const p = await collectRichPayload(req);
        if (!p.title || !p.category) return res.status(400).json({ error: 'title e category obrigatórios' });

        const existingRes = await db.query("SELECT id, slug, title FROM posts WHERE id=$1", [id]);
        const existing = existingRes.rows[0];
        if (!existing) return res.status(404).json({ error: 'Post não encontrado' });

        const targetBase = p.title !== existing.title || !existing.slug ? slugify(p.title) : existing.slug;
        const slug = await ensureUniqueSlug(targetBase, id);

        const heroSql = p.hero_url ? ", image_url=$17" : "";
        const params = [p.title, p.category, p.content, slug, p.brand, p.model, p.sku, p.color,
                        p.price_cents, p.retail_price_cents, p.release_date, p.excerpt, p.author, p.tags,
                        p.is_pinned, p.is_sponsored, id];
        if (p.hero_url) params.splice(16, 0, p.hero_url);

        await db.query(`UPDATE posts SET
            title=$1, category=$2, content=$3, slug=$4, brand=$5, model=$6, sku=$7, color=$8,
            price_cents=$9, retail_price_cents=$10, release_date=$11, excerpt=$12, author=$13, tags=$14,
            is_pinned=$15, is_sponsored=$16 ${heroSql}
            WHERE id=${p.hero_url ? '$18' : '$17'}`, params);

        const shouldReplace = p.gallery_urls.length || p.stores.length || p.related.length ||
                            req.body.stores !== undefined || req.body.related !== undefined;
        if (shouldReplace) {
            await replaceChildren(id, p);
        }
        res.json({ success: true, id: Number(id), slug });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/posts/:id', isAuthenticated, async (req, res) => {
    try {
        await db.query("DELETE FROM posts WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Clicks dashboard stats ---
router.get('/clicks/stats', isAuthenticated, async (req, res) => {
    try {
        const range = String(req.query.range || '7d');
        const windows = { '24h': "-1 day", '7d': "-7 days", '30d': "-30 days", 'all': null };
        const since = windows[range];
        const where = since ? "WHERE created_at >= CURRENT_TIMESTAMP + interval '$1'" : "";
        
        // Postgres syntax for intervals is different, but for simplicity let's use a simpler approach
        const last24h = await db.query("SELECT COUNT(*) FROM clicks WHERE created_at >= NOW() - INTERVAL '1 day'");
        const last7d = await db.query("SELECT COUNT(*) FROM clicks WHERE created_at >= NOW() - INTERVAL '7 days'");
        const last30d = await db.query("SELECT COUNT(*) FROM clicks WHERE created_at >= NOW() - INTERVAL '30 days'");
        const total = await db.query("SELECT COUNT(*) FROM clicks");

        const byLabel = await db.query(`SELECT label, COUNT(*) AS count, MAX(created_at) AS last_seen
                                      FROM clicks GROUP BY label ORDER BY count DESC LIMIT 50`);
        
        const byDay = await db.query(`SELECT date_trunc('day', created_at) AS day, COUNT(*) AS count
                                    FROM clicks WHERE created_at >= NOW() - INTERVAL '14 days'
                                    GROUP BY day ORDER BY day ASC`);

        res.json({ 
            range, 
            totals: {
                last24h: parseInt(last24h.rows[0].count),
                last7d: parseInt(last7d.rows[0].count),
                last30d: parseInt(last30d.rows[0].count),
                total: parseInt(total.rows[0].count)
            },
            byLabel: byLabel.rows,
            byDay: byDay.rows 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Offers ---
async function collectOfferPayload(req) {
    const b = req.body || {};
    const file = req.file;

    let imageUrl = b.image_url || null;
    if (file) {
        imageUrl = await uploadToSupabase(file);
    }

    return {
        title: String(b.title || '').trim(),
        brand: String(b.brand || '').trim(),
        category: b.category || null,
        price_cents: priceToCents(b.price),
        retail_price_cents: priceToCents(b.retail_price),
        coupon: b.coupon ? String(b.coupon).trim().toUpperCase() : null,
        affiliate_url: String(b.affiliate_url || '').trim(),
        badge: b.badge ? String(b.badge).slice(0, 24) : null,
        position: intOrNull(b.position) ?? 0,
        is_active: b.is_active === 'false' || b.is_active === '0' ? 0 : 1,
        published_at: b.published_at || null,
        image_url: imageUrl
    };
}

router.get('/offers', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM offers ORDER BY position ASC, published_at DESC");
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/offers', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const p = await collectOfferPayload(req);
        const result = await db.query(`INSERT INTO offers
            (title, brand, category, image_url, price_cents, retail_price_cents, coupon, affiliate_url, badge, position, is_active, published_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, CURRENT_TIMESTAMP)) RETURNING id`,
            [p.title, p.brand, p.category, p.image_url, p.price_cents, p.retail_price_cents,
             p.coupon, p.affiliate_url, p.badge, p.position, p.is_active, p.published_at]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/offers/:id', isAuthenticated, async (req, res) => {
    try {
        await db.query("DELETE FROM offers WHERE id=$1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

