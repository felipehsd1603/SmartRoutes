const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to the database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Create Admins Table
        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`);

        // Create Posts Table
        db.run(`CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            image_url TEXT,
            content TEXT,
            published_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Seed a default admin if none exists
        db.get("SELECT COUNT(*) AS count FROM admins", (err, row) => {
            if (row && row.count === 0) {
                const defaultUsername = 'admin';
                const defaultPassword = 'admin'; // In production, force change on first login
                bcrypt.hash(defaultPassword, 10, (err, hash) => {
                    if (!err) {
                        db.run("INSERT INTO admins (username, password) VALUES (?, ?)", [defaultUsername, hash], (err) => {
                            if (!err) console.log("Default admin created: admin / admin");
                        });
                    }
                });
            }
        });
    });
}

module.exports = db;
