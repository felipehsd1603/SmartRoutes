const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('../database/db');

// Multer setup for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../../public/uploads/'))
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)) // Append extension
    }
});
const upload = multer({ storage: storage });

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/admin/login');
};

// Serve admin pages
router.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/login.html'));
});

// Login endpoint
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM admins WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: "Invalid credentials" });

        bcrypt.compare(password, row.password, (err, result) => {
            if (result) {
                req.session.userId = row.id;
                res.json({ success: true });
            } else {
                res.status(401).json({ error: "Invalid credentials" });
            }
        });
    });
});

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Admin Posts API endpoints
router.post('/posts', isAuthenticated, upload.single('image'), (req, res) => {
    const { title, category, content } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    db.run("INSERT INTO posts (title, category, image_url, content) VALUES (?, ?, ?, ?)",
        [title, category, imageUrl, content],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

router.delete('/posts/:id', isAuthenticated, (req, res) => {
    db.run("DELETE FROM posts WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

module.exports = router;
