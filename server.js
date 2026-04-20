require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const cors = require('cors');
const db = require('./src/database/db');

const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();
app.set('trust proxy', 1); // Necessário para sessões seguras no Render
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'sdm-smeaker-super-secret-key', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Desativado para garantir compatibilidade total no Render
        maxAge: 1000 * 60 * 60 * 24 // 24 horas
    }
}));

const SITE_URL = (process.env.SITE_URL || 'https://sdmlinks.com.br').replace(/\/$/, '');
const POST_HTML_PATH = path.join(__dirname, 'public', 'post.html');

function escAttr(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Post page — injeta meta tags server-side para crawlers/OG
app.get('/post/:slug', async (req, res) => {
    const slug = req.params.slug;
    try {
        const result = await db.query(
            'SELECT title, excerpt, image_url, brand, model, slug FROM posts WHERE slug = $1',
            [slug]
        );
        const p = result.rows[0];
        if (!p) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));

        const html = fs.readFileSync(POST_HTML_PATH, 'utf8');
        const title = escAttr(`${p.title} | SDM Links`);
        const desc  = escAttr(p.excerpt || `${[p.brand, p.model].filter(Boolean).join(' ')} — SDM Links`);
        const image = escAttr(p.image_url || `${SITE_URL}/og-cover.png`);
        const url   = escAttr(`${SITE_URL}/post/${p.slug}`);
        const jsonld = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': p.brand ? 'Product' : 'Article',
            name: p.title,
            description: p.excerpt || '',
            image: p.image_url || '',
            url: `${SITE_URL}/post/${p.slug}`,
            ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {})
        }).replace(/<\/script>/gi, '<\\/script>');

        const injected = html
            .replace(/__OG_TITLE__/g, title)
            .replace(/__OG_DESC__/g, desc)
            .replace(/__OG_IMAGE__/g, image)
            .replace(/__OG_URL__/g, url)
            .replace('__OG_JSONLD__', jsonld);

        res.send(injected);
    } catch {
        res.sendFile(POST_HTML_PATH);
    }
});

// Calendário de lançamentos
app.get('/calendario', (req, res) => {
    const calPath = path.join(__dirname, 'public', 'calendario.html');
    res.sendFile(calPath, err => {
        if (err) res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    });
});

// Sitemap dinâmico
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT slug, published_at FROM posts WHERE slug IS NOT NULL ORDER BY published_at DESC'
        );
        const fmt = d => d ? new Date(d).toISOString().split('T')[0] : '';
        const urls = [
            `<url><loc>${SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
            `<url><loc>${SITE_URL}/calendario</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`,
            ...result.rows.map(p =>
                `<url><loc>${SITE_URL}/post/${p.slug}</loc>${p.published_at ? `<lastmod>${fmt(p.published_at)}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.7</priority></url>`
            )
        ].join('\n');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
    } catch (err) {
        res.status(500).send('Error generating sitemap');
    }
});

// Favicon
app.get('/favicon.ico', (req, res) => {
    res.redirect(301, '/icon-192.png');
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

// Microsoft Clarity — served dynamically so the ID comes from env var
app.get('/clarity.js', (req, res) => {
    const clarityId = process.env.CLARITY_ID || '';
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (!clarityId) return res.send('// Clarity not configured');
    res.send(`
(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","${clarityId}");
    `.trim());
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

// 404 handler — deve ficar após todas as rotas
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

