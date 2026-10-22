require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'verified-payments.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function razorpayClient() {
  if (!KEY_ID || !KEY_SECRET || KEY_ID.includes('REPLACE_WITH') || KEY_SECRET.includes('REPLACE_WITH')) {
    const error = new Error('Razorpay test keys are not configured. Copy .env.example to .env and add your TEST API keys.');
    error.status = 503; throw error;
  }
  if (!KEY_ID.startsWith('rzp_test_')) {
    const error = new Error('This project is configured for test mode only. RAZORPAY_KEY_ID must start with rzp_test_.');
    error.status = 400; throw error;
  }
  return new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
}
app.use(express.json({ limit: '30kb' }));
app.use(session({
  name: 'glamflow.sid',
  secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Small in-memory login throttle for this single-instance local demo.
const loginAttempts = new Map();
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  return res.status(401).json({ error: 'Please sign in to continue.' });
}
app.post('/api/auth/login', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let attempt = loginAttempts.get(ip);
  if (!attempt || now - attempt.startedAt > 15 * 60 * 1000) attempt = { startedAt: now, count: 0 };
  if (attempt.count >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in your .env file.' });
  }
  const userOk = safeStringEqual(username, ADMIN_USERNAME);
  const passwordOk = safeStringEqual(password, ADMIN_PASSWORD);
  if (!userOk || !passwordOk) {
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ error: 'Incorrect username or password. Please try again.' });
  }
  loginAttempts.delete(ip);
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.authenticated = true;
    req.session.username = ADMIN_USERNAME;
    req.session.save(saveErr => {
      if (saveErr) return next(saveErr);
      res.json({ ok: true, username: ADMIN_USERNAME });
    });
  });
});
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.authenticated === true) return res.json({ authenticated: true, username: req.session.username });
  res.status(401).json({ authenticated: false });
});
app.post('/api/auth/logout', (req, res, next) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('glamflow.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });
});
function safeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}
app.get('/api/config', (req, res) => {
  if (!KEY_ID || KEY_ID.includes('REPLACE_WITH')) return res.json({ keyId: '' });
  if (!KEY_ID.startsWith('rzp_test_')) return res.status(400).json({ error: 'Only Razorpay test keys are allowed by this demo.' });
  res.json({ keyId: KEY_ID, mode: 'test' });
});
app.post('/api/create-order', requireAuth, async (req, res) => {
  try {
    const razorpay = razorpayClient();
    const bookingId = Number(req.body.bookingId);
    const amountRupees = Number(req.body.amount);
    const description = String(req.body.description || 'GlamFlow makeup booking').slice(0, 120);
    if (!Number.isInteger(bookingId) || bookingId < 1) return res.status(400).json({ error: 'A valid booking ID is required.' });
    if (!Number.isFinite(amountRupees) || amountRupees <= 0 || amountRupees > 500000) return res.status(400).json({ error: 'Amount must be greater than ₹0 and no more than ₹5,00,000 for this demo.' });
    const amountPaise = Math.round(amountRupees * 100);
    if (amountPaise < 100) return res.status(400).json({ error: 'Minimum payment amount is ₹1.' });
    const order = await razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt: `gf_${bookingId}_${Date.now()}`, notes: { bookingId: String(bookingId), app: 'GlamFlow' } });
    const orders = readJson(ORDERS_FILE, {});
    orders[order.id] = { orderId: order.id, bookingId, amount: amountPaise, currency: 'INR', description, createdAt: new Date().toISOString(), status: 'created' };
    writeJson(ORDERS_FILE, orders);
    res.json({ id: order.id, amount: order.amount, currency: order.currency, description });
  } catch (err) {
    console.error('Create order error:', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not create a Razorpay order. Check your test keys and try again.' });
  }
});
app.post('/api/verify-payment', requireAuth, (req, res) => {
  try {
    if (!KEY_SECRET || KEY_SECRET.includes('REPLACE_WITH')) return res.status(503).json({ verified: false, error: 'Razorpay test secret is not configured on the server.' });
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    if (!orderId || !paymentId || !signature) return res.status(400).json({ verified: false, error: 'Missing Razorpay payment verification fields.' });
    const orders = readJson(ORDERS_FILE, {});
    const order = orders[orderId];
    if (!order) return res.status(400).json({ verified: false, error: 'Order was not created by this GlamFlow server.' });
    const expected = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const providedBuf = Buffer.from(String(signature));
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return res.status(400).json({ verified: false, error: 'Payment signature verification failed.' });
    }
    const payments = readJson(PAYMENTS_FILE, []);
    const existing = payments.find(p => p.paymentId === paymentId);
    if (existing) return res.json({ verified: true, payment: existing, duplicate: true });
    const payment = { paymentId, orderId, bookingId: order.bookingId, amount: order.amount, currency: order.currency, status: 'signature_verified', verifiedAt: new Date().toISOString(), mode: 'test' };
    payments.push(payment);
    writeJson(PAYMENTS_FILE, payments);
    order.status = 'signature_verified';
    order.paymentId = paymentId;
    orders[orderId] = order;
    writeJson(ORDERS_FILE, orders);
    res.json({ verified: true, payment });
  } catch (err) {
    console.error('Verify payment error:', err.message);
    res.status(500).json({ verified: false, error: 'Could not verify this payment. Please check the server logs.' });
  }
});
app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'test', keysConfigured: Boolean(KEY_ID && KEY_SECRET && !KEY_ID.includes('REPLACE_WITH') && !KEY_SECRET.includes('REPLACE_WITH')), authenticationConfigured: Boolean(ADMIN_USERNAME && ADMIN_PASSWORD && SESSION_SECRET) }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => {
  console.log(`GlamFlow running at http://localhost:${PORT} (Razorpay test mode only)`);
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) console.warn('WARNING: Set ADMIN_USERNAME and ADMIN_PASSWORD in .env before signing in.');
  if (!SESSION_SECRET) console.warn('WARNING: Set a unique SESSION_SECRET in .env before using authentication.');
});
