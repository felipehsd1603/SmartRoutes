const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Get all posts
router.get('/posts', (req, res) => {
    db.all("SELECT * FROM posts ORDER BY published_at DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ data: rows });
    });
});

// Get latest posts for specific categories
router.get('/posts/category/:category', (req, res) => {
    const category = req.params.category;
    db.all("SELECT * FROM posts WHERE category = ? ORDER BY published_at DESC LIMIT 6", [category], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ data: rows });
    });
});

module.exports = router;
