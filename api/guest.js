const jwt = require('jsonwebtoken');

module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
  const email = `guest-${Date.now()}@local.dev`;
  const token = jwt.sign({ id: null, email, guest: true }, JWT_SECRET, { expiresIn: '1h' });
  res.status(200).json({ token, user: { id: null, email, provider: 'guest' }, note: 'temporary: no DB write' });
};