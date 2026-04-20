require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');

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

// Post page
app.get('/post/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'post.html'));
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

