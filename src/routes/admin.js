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
    { name: 'cover', maxCount: 1 },
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
    const coverFile = req.files?.cover?.[0];
    const galleryFiles = req.files?.gallery || [];
    const relatedFiles = req.files?.related_images || [];

    // Upload hero image to Supabase
    let heroUrl = b.image_url || null;
    if (heroFile) {
        heroUrl = await uploadToSupabase(heroFile);
    }

    // Upload cover image (editorial, full-bleed) to Supabase
    let coverUrl = b.cover_image_url || null;
    if (coverFile) {
        coverUrl = await uploadToSupabase(coverFile);
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

    // Normaliza hero_color: aceita #RGB, #RRGGBB, ou vazio
    let heroColor = (b.hero_color || '').trim();
    if (heroColor && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(heroColor)) heroColor = null;

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
        cover_url: coverUrl,
        hero_color: heroColor || null,
        video_url: b.video_url ? String(b.video_url).trim() : null,
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
        console.log(`Tentativa de login para o usuÃ¡rio: ${username}`);
        
        const result = await db.query("SELECT * FROM admins WHERE username = $1", [username]);
        const row = result.rows[0];

        if (!row) {
            console.warn(`UsuÃ¡rio ${username} nÃ£o encontrado no banco.`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const match = await bcrypt.compare(password, row.password);
        if (match) {
            console.log(`Login bem-sucedido para: ${username}`);
            req.session.userId = row.id;
            // Garantir que a sessÃ£o seja salva antes de responder
            req.session.save((err) => {
                if (err) {
                    console.error('Erro ao salvar sessÃ£o:', err);
                    return res.status(500).json({ error: 'Erro de sessÃ£o' });
                }
                res.json({ success: true });
            });
        } else {
            console.warn(`Senha incorreta para o usuÃ¡rio: ${username}`);
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
        if (!post) return res.status(404).json({ error: 'Post nÃ£o encontrado' });

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
        if (!p.title || !p.category) return res.status(400).json({ error: 'title e category obrigatÃ³rios' });

        const slug = await ensureUniqueSlug(slugify(p.title), null);
        const result = await db.query(`INSERT INTO posts (
            title, category, image_url, content, slug, brand, model, sku, color,
            price_cents, retail_price_cents, release_date, excerpt, author, tags, is_pinned, is_sponsored,
            hero_color, cover_image_url, video_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
            [p.title, p.category, p.hero_url, p.content, slug, p.brand, p.model, p.sku, p.color,
             p.price_cents, p.retail_price_cents, p.release_date, p.excerpt, p.author, p.tags, p.is_pinned, p.is_sponsored,
             p.hero_color, p.cover_url, p.video_url]);
        
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
        if (!p.title || !p.category) return res.status(400).json({ error: 'title e category obrigatÃ³rios' });

        const existingRes = await db.query("SELECT id, slug, title FROM posts WHERE id=$1", [id]);
        const existing = existingRes.rows[0];
        if (!existing) return res.status(404).json({ error: 'Post nÃ£o encontrado' });

        const targetBase = p.title !== existing.title || !existing.slug ? slugify(p.title) : existing.slug;
        const slug = await ensureUniqueSlug(targetBase, id);

        // COALESCE para image_url/cover_image_url: só atualiza se nova mídia
        await db.query(`UPDATE posts SET
            title=$1, category=$2, content=$3, slug=$4, brand=$5, model=$6, sku=$7, color=$8,
            price_cents=$9, retail_price_cents=$10, release_date=$11, excerpt=$12, author=$13, tags=$14,
            is_pinned=$15, is_sponsored=$16,
            hero_color=$17,
            image_url = COALESCE($18, image_url),
            cover_image_url = COALESCE($19, cover_image_url),
            video_url = $20,
            updated_at = CURRENT_TIMESTAMP
            WHERE id=$21`,
            [p.title, p.category, p.content, slug, p.brand, p.model, p.sku, p.color,
             p.price_cents, p.retail_price_cents, p.release_date, p.excerpt, p.author, p.tags,
             p.is_pinned, p.is_sponsored, p.hero_color, p.hero_url, p.cover_url, p.video_url, id]);

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

router.get('/offers/:id', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM offers WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Oferta não encontrada' });
        res.json({ data: result.rows[0] });
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

router.put('/offers/:id', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const p = await collectOfferPayload(req);
        await db.query(`UPDATE offers SET
            title=$1, brand=$2, category=$3, image_url=COALESCE(NULLIF($4,''), image_url),
            price_cents=$5, retail_price_cents=$6, coupon=$7, affiliate_url=$8,
            badge=$9, position=$10, is_active=$11
            WHERE id=$12`,
            [p.title, p.brand, p.category, p.image_url, p.price_cents, p.retail_price_cents,
             p.coupon, p.affiliate_url, p.badge, p.position, p.is_active, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/offers/:id/toggle', isAuthenticated, async (req, res) => {
    try {
        await db.query("UPDATE offers SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=$1", [req.params.id]);
        const result = await db.query("SELECT is_active FROM offers WHERE id=$1", [req.params.id]);
        res.json({ success: true, is_active: result.rows[0]?.is_active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Coupons ---
function collectCouponPayload(req) {
    const b = req.body || {};
    return {
        code: String(b.code || '').trim().toUpperCase(),
        brand: b.brand ? String(b.brand).trim() : null,
        discount_label: b.discount_label ? String(b.discount_label).trim() : null,
        url: b.url ? String(b.url).trim() : null,
        variant: b.variant ? String(b.variant).trim() : 'primary',
        position: intOrNull(b.position) ?? 0,
        is_active: b.is_active === 'false' || b.is_active === '0' ? 0 : 1,
        published_at: b.published_at || null
    };
}

router.get('/coupons', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM coupons ORDER BY position ASC, published_at DESC");
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/coupons/:id', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM coupons WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Cupom não encontrado' });
        res.json({ data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/coupons', isAuthenticated, async (req, res) => {
    try {
        const p = collectCouponPayload(req);
        if (!p.code) return res.status(400).json({ error: 'code obrigatório' });
        const result = await db.query(`INSERT INTO coupons
            (code, brand, discount_label, url, variant, position, is_active, published_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_TIMESTAMP)) RETURNING id`,
            [p.code, p.brand, p.discount_label, p.url, p.variant, p.position, p.is_active, p.published_at]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/coupons/:id', isAuthenticated, async (req, res) => {
    try {
        const p = collectCouponPayload(req);
        if (!p.code) return res.status(400).json({ error: 'code obrigatório' });
        await db.query(`UPDATE coupons SET
            code=$1, brand=$2, discount_label=$3, url=$4, variant=$5,
            position=$6, is_active=$7
            WHERE id=$8`,
            [p.code, p.brand, p.discount_label, p.url, p.variant, p.position, p.is_active, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/coupons/:id', isAuthenticated, async (req, res) => {
    try {
        await db.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/coupons/:id/toggle', isAuthenticated, async (req, res) => {
    try {
        await db.query("UPDATE coupons SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=$1", [req.params.id]);
        const result = await db.query("SELECT is_active FROM coupons WHERE id=$1", [req.params.id]);
        res.json({ success: true, is_active: result.rows[0]?.is_active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Partnerships ---
function collectPartnershipPayload(req) {
    const b = req.body || {};
    return {
        title: String(b.title || '').trim(),
        subtitle: b.subtitle ? String(b.subtitle).trim() : null,
        badge: b.badge ? String(b.badge).trim() : null,
        highlight: b.highlight ? String(b.highlight).trim() : null,
        cta_label: b.cta_label ? String(b.cta_label).trim() : null,
        cta_url: b.cta_url ? String(b.cta_url).trim() : null,
        position: intOrNull(b.position) ?? 0,
        is_active: b.is_active === 'false' || b.is_active === '0' ? 0 : 1,
        published_at: b.published_at || null
    };
}

router.get('/partnerships', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM partnerships ORDER BY position ASC, published_at DESC");
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/partnerships/:id', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM partnerships WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Parceria não encontrada' });
        res.json({ data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/partnerships', isAuthenticated, async (req, res) => {
    try {
        const p = collectPartnershipPayload(req);
        if (!p.title) return res.status(400).json({ error: 'title obrigatório' });
        const result = await db.query(`INSERT INTO partnerships
            (title, subtitle, badge, highlight, cta_label, cta_url, position, is_active, published_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_TIMESTAMP)) RETURNING id`,
            [p.title, p.subtitle, p.badge, p.highlight, p.cta_label, p.cta_url, p.position, p.is_active, p.published_at]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/partnerships/:id', isAuthenticated, async (req, res) => {
    try {
        const p = collectPartnershipPayload(req);
        if (!p.title) return res.status(400).json({ error: 'title obrigatório' });
        await db.query(`UPDATE partnerships SET
            title=$1, subtitle=$2, badge=$3, highlight=$4, cta_label=$5, cta_url=$6,
            position=$7, is_active=$8
            WHERE id=$9`,
            [p.title, p.subtitle, p.badge, p.highlight, p.cta_label, p.cta_url, p.position, p.is_active, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/partnerships/:id', isAuthenticated, async (req, res) => {
    try {
        await db.query("DELETE FROM partnerships WHERE id=$1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/partnerships/:id/toggle', isAuthenticated, async (req, res) => {
    try {
        await db.query("UPDATE partnerships SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=$1", [req.params.id]);
        const result = await db.query("SELECT is_active FROM partnerships WHERE id=$1", [req.params.id]);
        res.json({ success: true, is_active: result.rows[0]?.is_active });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Feature Flags ---
router.get('/features', isAuthenticated, async (req, res) => {
    try {
        const r = await db.query("SELECT * FROM features ORDER BY position ASC, key ASC");
        res.json({ data: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.patch('/features/:key/toggle', isAuthenticated, async (req, res) => {
    try {
        await db.query("UPDATE features SET is_enabled = CASE WHEN is_enabled=1 THEN 0 ELSE 1 END WHERE key=$1", [req.params.key]);
        const r = await db.query("SELECT is_enabled FROM features WHERE key=$1", [req.params.key]);
        res.json({ success: true, is_enabled: r.rows[0]?.is_enabled });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Raffles ---
function collectRafflePayload(req) {
    const b = req.body || {};
    return {
        title: String(b.title || '').trim(),
        description: b.description || null,
        image_url: b.image_url || null,
        source: b.source || null,
        cta_label: b.cta_label || null,
        cta_url: b.cta_url || null,
        starts_at: b.starts_at || null,
        ends_at: b.ends_at || null,
        position: intOrNull(b.position) ?? 0,
        is_active: b.is_active === 'false' || b.is_active === '0' ? 0 : 1
    };
}
router.get('/raffles', isAuthenticated, async (req, res) => {
    try { const r = await db.query("SELECT * FROM raffles ORDER BY position ASC, published_at DESC"); res.json({ data: r.rows }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/raffles/:id', isAuthenticated, async (req, res) => {
    try { const r = await db.query("SELECT * FROM raffles WHERE id=$1", [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Raffle não encontrado' });
        res.json({ data: r.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/raffles', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const p = collectRafflePayload(req);
        if (req.file) p.image_url = await uploadToSupabase(req.file);
        if (!p.title) return res.status(400).json({ error: 'title obrigatório' });
        const r = await db.query(`INSERT INTO raffles
            (title, description, image_url, source, cta_label, cta_url, starts_at, ends_at, position, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [p.title, p.description, p.image_url, p.source, p.cta_label, p.cta_url, p.starts_at, p.ends_at, p.position, p.is_active]);
        res.json({ success: true, id: r.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/raffles/:id', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const p = collectRafflePayload(req);
        if (req.file) p.image_url = await uploadToSupabase(req.file);
        await db.query(`UPDATE raffles SET title=$1, description=$2,
            image_url=COALESCE(NULLIF($3,''), image_url),
            source=$4, cta_label=$5, cta_url=$6, starts_at=$7, ends_at=$8,
            position=$9, is_active=$10 WHERE id=$11`,
            [p.title, p.description, p.image_url, p.source, p.cta_label, p.cta_url, p.starts_at, p.ends_at, p.position, p.is_active, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/raffles/:id', isAuthenticated, async (req, res) => {
    try { await db.query("DELETE FROM raffles WHERE id=$1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
router.patch('/raffles/:id/toggle', isAuthenticated, async (req, res) => {
    try { await db.query("UPDATE raffles SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id=$1", [req.params.id]);
        const r = await db.query("SELECT is_active FROM raffles WHERE id=$1", [req.params.id]);
        res.json({ success: true, is_active: r.rows[0]?.is_active });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Restocks por post ---
router.get('/posts/:id/restocks', isAuthenticated, async (req, res) => {
    try { const r = await db.query("SELECT * FROM post_restocks WHERE post_id=$1 ORDER BY restocked_at DESC", [req.params.id]);
        res.json({ data: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/posts/:id/restocks', isAuthenticated, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.restocked_at) return res.status(400).json({ error: 'restocked_at obrigatório' });
        const r = await db.query(
            "INSERT INTO post_restocks (post_id, store_name, restocked_at, price_cents, url) VALUES ($1,$2,$3,$4,$5) RETURNING id",
            [req.params.id, b.store_name || null, b.restocked_at, priceToCents(b.price), b.url || null]
        );
        res.json({ success: true, id: r.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/restocks/:id', isAuthenticated, async (req, res) => {
    try { await db.query("DELETE FROM post_restocks WHERE id=$1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Comments moderation ---
router.get('/comments', isAuthenticated, async (req, res) => {
    try {
        const status = req.query.status;
        let sql, params = [];
        if (status === 'approved') { sql = `SELECT c.*, p.title AS post_title, p.slug AS post_slug FROM comments c LEFT JOIN posts p ON p.id=c.post_id WHERE c.is_approved=1 ORDER BY c.created_at DESC LIMIT 200`; }
        else if (status === 'all') { sql = `SELECT c.*, p.title AS post_title, p.slug AS post_slug FROM comments c LEFT JOIN posts p ON p.id=c.post_id ORDER BY c.created_at DESC LIMIT 200`; }
        else { sql = `SELECT c.*, p.title AS post_title, p.slug AS post_slug FROM comments c LEFT JOIN posts p ON p.id=c.post_id WHERE c.is_approved=0 ORDER BY c.created_at DESC LIMIT 200`; }
        const r = await db.query(sql, params);
        res.json({ data: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.patch('/comments/:id/approve', isAuthenticated, async (req, res) => {
    try { await db.query("UPDATE comments SET is_approved=1 WHERE id=$1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/comments/:id', isAuthenticated, async (req, res) => {
    try { await db.query("DELETE FROM comments WHERE id=$1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Reviews moderation ---
router.get('/reviews', isAuthenticated, async (req, res) => {
    try {
        const status = req.query.status;
        let sql;
        if (status === 'approved') { sql = `SELECT r.*, p.title AS post_title, p.slug AS post_slug FROM reviews r LEFT JOIN posts p ON p.id=r.post_id WHERE r.is_approved=1 ORDER BY r.created_at DESC LIMIT 200`; }
        else if (status === 'all') { sql = `SELECT r.*, p.title AS post_title, p.slug AS post_slug FROM reviews r LEFT JOIN posts p ON p.id=r.post_id ORDER BY r.created_at DESC LIMIT 200`; }
        else { sql = `SELECT r.*, p.title AS post_title, p.slug AS post_slug FROM reviews r LEFT JOIN posts p ON p.id=r.post_id WHERE r.is_approved=0 ORDER BY r.created_at DESC LIMIT 200`; }
        const r = await db.query(sql);
        res.json({ data: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
router.patch('/reviews/:id/approve', isAuthenticated, async (req, res) => {
    try { await db.query("UPDATE reviews SET is_approved=1 WHERE id=$1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/reviews/:id', isAuthenticated, async (req, res) => {
    try { await db.query("DELETE FROM reviews WHERE id=$1", [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Newsletter subscribers ---
router.get('/newsletter', isAuthenticated, async (req, res) => {
    try {
        const r = await db.query("SELECT id, email, created_at FROM newsletter_subscriptions ORDER BY created_at DESC LIMIT 500");
        res.json({ data: r.rows, total: r.rows.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Settings / Banner ---
router.get('/settings/banner', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT key, value FROM settings WHERE key LIKE 'banner_%'");
        const config = {};
        for (const row of result.rows) config[row.key] = row.value;
        res.json({ data: config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/settings/banner', isAuthenticated, async (req, res) => {
    try {
        const fields = ['banner_active', 'banner_text', 'banner_telegram_url', 'banner_whatsapp_url', 'banner_bg_color'];
        for (const key of fields) {
            if (req.body[key] !== undefined) {
                await db.query(
                    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
                    [key, String(req.body[key])]
                );
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Seed de post exemplo (dev/demo) ---
router.get('/seed-example-post', isAuthenticated, async (req, res) => {
    const slug = 'michael-jordan-estreia-nike-phantom-6-low-hot-punch';
    try {
        const existing = await db.query("SELECT id, slug FROM posts WHERE slug = $1", [slug]);
        if (existing.rows.length) {
            return res.redirect(`/post/${existing.rows[0].slug}`);
        }

        const releaseDate = new Date(Date.now() + 3 * 86400000).toISOString();
        const content = `Michael Jordan voltou a ser manchete do mundo sneaker — e desta vez com um colorway que ninguém esperava: "Hot Punch/Green Strike".

Inspirada no tom radioactive dos modelos de futebol, a edição marca uma inflexão na linha Phantom 6 Low, que cruza de vez a fronteira entre performance esportiva e streetwear.

Drop oficial nas lojas parceiras em 72h. Se cadastra no "Me avise" pra ser avisado na hora do drop.`;

        const excerpt = 'Michael Jordan estampa a campanha da Nike Phantom 6 Low "Hot Punch/Green Strike" — drop editorial em 72h.';
        const coverUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Michael_Jordan_in_2014.jpg/1280px-Michael_Jordan_in_2014.jpg';
        const heroImageUrl = 'https://placehold.co/1200x900/CCFF00/2E2E2E/png?text=Nike+Phantom+6+Low';
        const heroColor = '#CCFF00';

        const result = await db.query(`INSERT INTO posts (
            title, category, image_url, cover_image_url, hero_color, content, slug, brand, model, sku, color,
            price_cents, retail_price_cents, release_date, excerpt, author, tags, is_pinned, is_sponsored
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id, slug`, [
            'Michael Jordan estreia a Nike Phantom 6 Low "Hot Punch/Green Strike"',
            'Culture Conection',
            heroImageUrl, coverUrl, heroColor,
            content, slug,
            'Nike', 'Phantom 6 Low', 'FM1234-100', 'Hot Punch/Green Strike',
            89999, 109999,
            releaseDate, excerpt,
            'SDM Editorial',
            'Nike, Jordan, Phantom 6, Hot Punch, Green Strike, Basquete',
            1, 0
        ]);

        const { id, slug: newSlug } = result.rows[0];

        // Associa à primeira loja cadastrada (pra testar o overlay "Onde comprar")
        const storeRes = await db.query("SELECT id FROM stores ORDER BY id ASC LIMIT 1");
        if (storeRes.rows.length) {
            await db.query(
                "INSERT INTO post_stores (post_id, store_id, url, release_date, status) VALUES ($1, $2, $3, $4, $5)",
                [id, storeRes.rows[0].id, 'https://www.nike.com.br/phantom-6-low', releaseDate, 'dropping_soon']
            );
        }

        res.redirect(`/post/${newSlug}`);
    } catch (err) {
        res.status(500).send(`Erro ao criar post exemplo: ${err.message}`);
    }
});

// --- Settings / Ads ---
router.get('/settings/ads', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT key, value FROM settings WHERE key LIKE 'ads_%'");
        const config = {};
        for (const row of result.rows) config[row.key] = row.value;
        res.json({ data: config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/settings/ads', isAuthenticated, async (req, res) => {
    try {
        const fields = ['ads_enabled', 'ads_publisher_id', 'ads_slot_feed', 'ads_slot_post', 'ads_slot_sidebar'];
        for (const key of fields) {
            if (req.body[key] !== undefined) {
                await db.query(
                    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
                    [key, String(req.body[key])]
                );
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
