const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { body, validationResult } = require('express-validator');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const db = new DatabaseSync(path.join(__dirname, 'chat.db'));

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

const initSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  provider TEXT DEFAULT 'email',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
`;
db.exec(initSql);

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/auth/register', [body('email').isEmail(), body('password').isLength({ min: 6 })], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email, password } = req.body;
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare('INSERT INTO users (email, password, provider) VALUES (?, ?, ?)');
    const result = stmt.run(email.toLowerCase(), hashed, 'email');
    const token = jwt.sign({ id: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastInsertRowid, email, provider: 'email' } });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', [body('email').isEmail(), body('password').isLength({ min: 6 })], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, provider: user.provider } });
});

app.post('/api/auth/guest', (req, res) => {
  const email = `guest-${Date.now()}@local.dev`;
  const password = Math.random().toString(36).slice(-10);
  const hashed = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (email, password, provider) VALUES (?, ?, ?)');
  const result = stmt.run(email, hashed, 'guest');
  const token = jwt.sign({ id: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: result.lastInsertRowid, email, provider: 'guest' } });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, provider FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

app.get('/api/chats', authenticate, (req, res) => {
  const chats = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json({ chats });
});

app.post('/api/chats', authenticate, (req, res) => {
  const { title } = req.body;
  const result = db.prepare('INSERT INTO chats (user_id, title) VALUES (?, ?)').run(req.user.id, title || 'New chat');
  res.json({ chat: { id: result.lastInsertRowid, title: title || 'New chat', user_id: req.user.id } });
});

app.get('/api/chats/:id', authenticate, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const messages = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chat.id);
  res.json({ chat, messages });
});

app.post('/api/chats/:id/messages', authenticate, (req, res) => {
  const { role, content } = req.body;
  const stmt = db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)');
  const result = stmt.run(req.params.id, role, content);
  db.prepare('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ message: { id: result.lastInsertRowid, chat_id: req.params.id, role, content } });
});

app.put('/api/chats/:id', authenticate, (req, res) => {
  const { title } = req.body;
  db.prepare('UPDATE chats SET title = ? WHERE id = ? AND user_id = ?').run(title, req.params.id, req.user.id);
  res.json({ ok: true });
});

app.delete('/api/chats/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
