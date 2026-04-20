-- Script de configuração para Supabase (PostgreSQL)

-- 1. Tabela de Administradores
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);

-- 2. Tabela de Posts (Tênis)
CREATE TABLE IF NOT EXISTS posts (
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
    is_sponsored INTEGER DEFAULT 0
);

-- 3. Tabela de Lojas
CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    logo_url TEXT
);

-- 4. Galeria de Imagens
CREATE TABLE IF NOT EXISTS post_images (
    id SERIAL PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt TEXT,
    position INTEGER DEFAULT 0
);

-- 5. Preços por Loja
CREATE TABLE IF NOT EXISTS post_stores (
    id SERIAL PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    release_date TIMESTAMPTZ,
    status TEXT DEFAULT 'available_now'
);

-- 6. Produtos Relacionados
CREATE TABLE IF NOT EXISTS related_products (
    id SERIAL PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    name TEXT,
    image_url TEXT NOT NULL,
    store_url TEXT,
    position INTEGER DEFAULT 0
);

-- 7. Ofertas (Cards da Home)
CREATE TABLE IF NOT EXISTS offers (
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
);

-- 8. Cliques (Analytics)
CREATE TABLE IF NOT EXISTS clicks (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL,
    href TEXT,
    referrer TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. Seed de Lojas Padrão
INSERT INTO stores (name) VALUES 
('Nike'), ('Adidas'), ('New Balance'), ('StockX'), ('Kicks Crew'), 
('Ebay'), ('Supreme'), ('Aftermarket'), ('Farfetch'), ('Artwalk')
ON CONFLICT DO NOTHING;
