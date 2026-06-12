const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: '.env' });

console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PORT:', process.env.DB_PORT);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const JWT_SECRET = process.env.SESSION_SECRET || 'fallback-secret';

async function getDB() {
  return await mysql.createConnection(dbConfig);
}

// ── Auth middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Root route ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ── Register ─────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = await getDB();
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Username already taken' });
  } finally { db.end(); }
});

// ── Login ────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const db = await getDB();
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: rows[0].id, username: rows[0].username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username: rows[0].username });
  } finally { db.end(); }
});

// ── Get current user ─────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.username });
});

// ── Get today's records ──────────────────────────────────────
app.get('/api/records/today', requireAuth, async (req, res) => {
  const db = await getDB();
  try {
    const [rows] = await db.execute(
      `SELECT * FROM records WHERE user_id = ? AND DATE(created_at) = CURDATE() ORDER BY created_at ASC`,
      [req.userId]
    );
    res.json(rows);
  } finally { db.end(); }
});

// ── Get records for last 7 days ──────────────────────────────
app.get('/api/records/week', requireAuth, async (req, res) => {
  const db = await getDB();
  try {
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(DATE(created_at), '%Y-%m-%d') as day,
              SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
              SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
       FROM records
       WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [req.userId]
    );
    res.json(rows);
  } finally { db.end(); }
});

// ── Get all-time totals ──────────────────────────────────────
app.get('/api/records/totals', requireAuth, async (req, res) => {
  const db = await getDB();
  try {
    const [rows] = await db.execute(
      `SELECT
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as totalIncome,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as totalExpense
       FROM records WHERE user_id = ?`,
      [req.userId]
    );
    res.json(rows[0]);
  } finally { db.end(); }
});

// ── Add record ───────────────────────────────────────────────
app.post('/api/records', requireAuth, async (req, res) => {
  const { type, amount, label } = req.body;
  if (!type || !amount) return res.status(400).json({ error: 'Missing fields' });
  const db = await getDB();
  try {
    await db.execute(
      'INSERT INTO records (user_id, type, amount, label) VALUES (?, ?, ?, ?)',
      [req.userId, type, parseFloat(amount), label || '']
    );
    const [today] = await db.execute(
      `SELECT * FROM records WHERE user_id = ? AND DATE(created_at) = CURDATE() ORDER BY created_at ASC`,
      [req.userId]
    );
    const [week] = await db.execute(
      `SELECT DATE_FORMAT(DATE(created_at), '%Y-%m-%d') as day,
              SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
              SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
       FROM records
       WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [req.userId]
    );
    res.json({ today, week });
  } finally { db.end(); }
});

app.listen(3000, () => console.log('Brokie Wallet running on http://localhost:3000'));