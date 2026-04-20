require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');

let db;
let isPostgres = false;

if (process.env.DATABASE_URL) {
    console.log('Utilizando Supabase (PostgreSQL)...');
    isPostgres = true;
    db = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Necessário para Supabase/Render
    });
} else {
    console.log('Utilizando SQLite local...');
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.resolve(__dirname, 'database.sqlite');
    const sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error('Error connecting to SQLite', err.message);
    });

    // Wrapper para simular comportamento do PG no SQLite (simplificado)
    db = {
        query: (text, params) => {
            return new Promise((resolve, reject) => {
                const sql = text.replace(/\$\d+/g, '?'); // Converte $1 para ?
                if (text.trim().toUpperCase().startsWith('SELECT')) {
                    sqliteDb.all(sql, params, (err, rows) => {
                        if (err) reject(err);
                        else resolve({ rows });
                    });
                } else {
                    sqliteDb.run(sql, params, function(err) {
                        if (err) reject(err);
                        else resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
                    });
                }
            });
        }
    };
}

// Inicialização automática das tabelas no Supabase (se necessário)
if (isPostgres) {
    initializePostgres();
}

async function initializePostgres() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(`CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            image_url TEXT,
            content TEXT,
            published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            slug TEXT UNIQUE,
            brand TEXT,
            model TEXT,
            sku TEXT,
            color TEXT,
            price_cents INTEGER,
            retail_price_cents INTEGER,
            release_date TIMESTAMPTZ,
            excerpt TEXT,
            author TEXT,
            tags TEXT,
            is_pinned INTEGER DEFAULT 0,
            is_sponsored INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS stores (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            logo_url TEXT
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS post_images (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            alt TEXT,
            position INTEGER DEFAULT 0
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS post_stores (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            release_date TIMESTAMPTZ,
            status TEXT DEFAULT 'available_now'
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS related_products (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            name TEXT,
            image_url TEXT NOT NULL,
            store_url TEXT,
            position INTEGER DEFAULT 0
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS offers (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            brand TEXT NOT NULL,
            category TEXT,
            image_url TEXT,
            price_cents INTEGER,
            retail_price_cents INTEGER,
            coupon TEXT,
            affiliate_url TEXT NOT NULL,
            badge TEXT,
            position INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS coupons (
            id SERIAL PRIMARY KEY,
            code TEXT NOT NULL,
            brand TEXT,
            discount_label TEXT,
            url TEXT,
            variant TEXT DEFAULT 'primary',
            position INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS partnerships (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT,
            badge TEXT,
            highlight TEXT,
            cta_label TEXT,
            cta_url TEXT,
            position INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS features (
            key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            description TEXT,
            category TEXT DEFAULT 'general',
            is_enabled INTEGER DEFAULT 0,
            position INTEGER DEFAULT 0
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS raffles (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            image_url TEXT,
            source TEXT,
            cta_label TEXT,
            cta_url TEXT,
            starts_at TIMESTAMPTZ,
            ends_at TIMESTAMPTZ,
            position INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS post_restocks (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            store_name TEXT,
            restocked_at TIMESTAMPTZ NOT NULL,
            price_cents INTEGER,
            url TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            author_name TEXT NOT NULL,
            body TEXT NOT NULL,
            is_approved INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            author_name TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            body TEXT,
            is_approved INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )`);

        // Default banner config
        await client.query(`
            INSERT INTO settings (key, value) VALUES
            ('banner_active', 'false'),
            ('banner_text', '🔔 Receba drops e promoções em tempo real! Junte-se ao nosso Telegram e WhatsApp.'),
            ('banner_telegram_url', 'https://t.me/s/sneakersdomionlinks'),
            ('banner_whatsapp_url', 'https://wa.me/5511999999999'),
            ('banner_bg_color', '#0065FC'),
            ('ads_enabled', 'false'),
            ('ads_publisher_id', ''),
            ('ads_slot_feed', ''),
            ('ads_slot_post', ''),
            ('ads_slot_sidebar', '')
            ON CONFLICT (key) DO NOTHING
        `);

        await client.query(`CREATE TABLE IF NOT EXISTS clicks (
            id SERIAL PRIMARY KEY,
            label TEXT NOT NULL,
            href TEXT,
            referrer TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS notify_subscriptions (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            channel TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT,
            auth TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, channel, endpoint)
        )`);
        await client.query("CREATE INDEX IF NOT EXISTS idx_notify_post ON notify_subscriptions(post_id)");

        const stores = await client.query("SELECT COUNT(*) FROM stores");
        if (parseInt(stores.rows[0].count) === 0) {
            const defaults = ['StockX', 'Kicks Crew', 'Ebay', 'Supreme', 'Aftermarket', 'Nike', 'Adidas', 'New Balance', 'Farfetch', 'Artwalk'];
            for (const name of defaults) {
                await client.query("INSERT INTO stores (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
            }
        }

        // Migration: Add likes column if not exists
        await client.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0");

        // Migration: editorial fields (hero color, cover image, updated_at)
        await client.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS hero_color TEXT");
        await client.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS cover_image_url TEXT");
        await client.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP");

        // Migration: video embed + price alerts
        await client.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_url TEXT");
        await client.query("ALTER TABLE notify_subscriptions ADD COLUMN IF NOT EXISTS price_target_cents INTEGER");

        // Seed feature flags (nasce tudo desligado — admin liga depois)
        const flagsSeed = [
            ['countdown_cards', 'Countdown ao vivo nos cards', 'Badge "07d 12h" nos próximos lançamentos da home.', 'tier1', 10],
            ['price_alert', 'Alerta de preço', 'Visitante pede para ser avisado se preço cair abaixo de X.', 'tier1', 20],
            ['seo_rich_products', 'Rich snippets (schema.org)', 'JSON-LD Product nas páginas de post para Google.', 'tier1', 30],
            ['brand_pages', 'Páginas de marca', 'Hub /brand/:slug agrupando posts por marca.', 'tier1', 40],
            ['just_dropped', 'Widget "Acabou de cair"', 'Toast flutuante com último post publicado.', 'tier1', 50],
            ['raffles', 'Sorteios / raffles', 'Seção dedicada + CRUD admin.', 'tier2', 60],
            ['restock_history', 'Histórico de restock', 'Mostra restocks anteriores na página do post.', 'tier2', 70],
            ['price_compare', 'Comparador de preço entre lojas', 'Ordena lojas por preço e destaca menor.', 'tier2', 80],
            ['comments', 'Comentários moderados', 'Comentários na página do post com moderação.', 'tier2', 90],
            ['reviews', 'Avaliações 1-5 estrelas', 'Reviews com rating agregado em JSON-LD.', 'tier2', 100],
            ['dark_mode', 'Modo escuro', 'Toggle na header + preferência no localStorage.', 'tier3', 110],
            ['email_newsletter', 'Newsletter por e-mail', 'Captura de e-mail no CTA final.', 'tier3', 120],
            ['post_video', 'Vídeo no post', 'Campo video_url embed YouTube.', 'tier3', 130],
            ['vs_compare', 'Comparador de modelos', 'Página /vs/:a/:b com specs/preços lado a lado.', 'tier3', 140],
            ['user_wishlist', 'Wishlist com login (roadmap)', 'Requer contas de usuário. Deixado para fase futura.', 'roadmap', 150]
        ];
        for (const [key, label, description, category, position] of flagsSeed) {
            await client.query(
                `INSERT INTO features (key, label, description, category, is_enabled, position)
                 VALUES ($1, $2, $3, $4, 0, $5) ON CONFLICT (key) DO NOTHING`,
                [key, label, description, category, position]
            );
        }

        const offersCount = await client.query("SELECT COUNT(*) FROM offers");
        if (parseInt(offersCount.rows[0].count) === 0) {
            const initialOffers = [
                ["Air Force 1 Low 'Oil Green' · -44%", "Nike", "Lifestyle", 44999, 79999, null, "https://www.nike.com.br/", "-44%", 1],
                ["Nike Cortez 'White Black' · -33%", "Nike", "Lifestyle", 43224, 64999, "CASUAL30", "https://www.nike.com.br/", "-33%", 2],
                ["New Balance 530 'Wolf Grey' · -20%", "New Balance", "Lifestyle", 59849, 74999, "SDMLINKS", "https://www.newbalance.com.br/", "-20%", 3],
                ["Air Force 1 Low GS 'Black Gold' · -40%", "Nike", "Lifestyle", 41799, 69999, "NIKE20", "https://www.nike.com.br/", "-40%", 4],
                ["Nike JA 1 'Smoke Grey' · -55%", "Nike", "Basquete", 53599, 119999, "NIKE20", "https://www.nike.com.br/", "-55%", 5],
                ["Nike Air Max Solo · -51%", "Nike", "Lifestyle", 38999, 79999, null, "https://www.nike.com.br/", "-51%", 6]
            ];
            for (const o of initialOffers) {
                await client.query(`INSERT INTO offers 
                    (title, brand, category, price_cents, retail_price_cents, coupon, affiliate_url, badge, position, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`, o);
            }
        }

        await client.query('COMMIT');
        console.log('Banco de dados PostgreSQL (Supabase) inicializado com sucesso.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Erro ao inicializar PostgreSQL:', e);
    } finally {
        client.release();
    }
}

module.exports = {
    query: (text, params) => db.query(text, params),
    isPostgres: isPostgres
};
