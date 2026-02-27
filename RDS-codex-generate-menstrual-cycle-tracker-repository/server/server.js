require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.USERS_DB_PATH || path.join(DATA_DIR, 'users-db.json');
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'cycleflow-local-secret';
const TOKEN_TTL_SEC = 60 * 60 * 24 * 30;
const MAX_DATA_BYTES = 1024 * 1024;

const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'PASTE_YOUR_PUBLIC_KEY';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'PASTE_YOUR_PRIVATE_KEY';
if (
  publicVapidKey !== 'PASTE_YOUR_PUBLIC_KEY'
  && privateVapidKey !== 'PASTE_YOUR_PRIVATE_KEY'
) {
  webpush.setVapidDetails('mailto:cycleflow@example.com', publicVapidKey, privateVapidKey);
}

const emptyDb = () => ({ users: [], subscriptions: [] });
let writeQueue = Promise.resolve();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function sanitizeName(name, fallback = 'Пользователь') {
  const normalized = String(name || '').trim();
  return normalized || fallback;
}

function createDataSkeleton() {
  return {
    cycles: [],
    days: {},
    settings: {
      theme: 'auto',
      notifications: false,
      delayThreshold: 3,
      rules: {
        avgCycleLength: 28,
        avgPeriodLength: 5,
        allowedCycleRange: [21, 35]
      }
    },
    profile: {
      name: '',
      email: '',
      flowType: '',
      goal: '',
      onboardingCompleted: false
    },
    auth: { email: '', password: '' },
    session: { loggedIn: false, authToken: '', userId: '' },
    pushSubscription: null,
    remindLaterUntil: null
  };
}

function normalizeUserData(rawData, userMeta = {}) {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const normalized = createDataSkeleton();

  normalized.cycles = Array.isArray(data.cycles) ? data.cycles : [];
  normalized.days = data.days && typeof data.days === 'object' ? data.days : {};

  if (data.settings && typeof data.settings === 'object') {
    normalized.settings = {
      ...normalized.settings,
      ...data.settings,
      rules: {
        ...normalized.settings.rules,
        ...(data.settings.rules && typeof data.settings.rules === 'object' ? data.settings.rules : {})
      }
    };
  }

  if (data.profile && typeof data.profile === 'object') {
    normalized.profile = { ...normalized.profile, ...data.profile };
  }
  normalized.profile.name = sanitizeName(normalized.profile.name || userMeta.name, 'Пользователь');
  normalized.profile.email = normalizeEmail(normalized.profile.email || userMeta.email);
  normalized.profile.onboardingCompleted = Boolean(normalized.profile.onboardingCompleted || userMeta.id);

  normalized.auth = {
    email: normalizeEmail(normalized.profile.email || userMeta.email),
    password: ''
  };

  normalized.session = {
    loggedIn: false,
    authToken: '',
    userId: userMeta.id || ''
  };

  normalized.pushSubscription = data.pushSubscription || null;
  normalized.remindLaterUntil = data.remindLaterUntil || null;

  return normalized;
}

function userPublic(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name
  };
}

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch (_) {
    await fs.writeFile(DB_PATH, JSON.stringify(emptyDb(), null, 2), 'utf8');
  }
}

async function readDb() {
  await ensureDb();
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.users = Array.isArray(parsed.users) ? parsed.users : [];
    parsed.subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
    return parsed;
  } catch (_) {
    const fallback = emptyDb();
    await fs.writeFile(DB_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

async function writeDb(nextDb) {
  writeQueue = writeQueue.then(async () => {
    await ensureDb();
    await fs.writeFile(DB_PATH, JSON.stringify(nextDb, null, 2), 'utf8');
  });
  return writeQueue;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64UrlEncode(value) {
  return Buffer
    .from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const base = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = base.length % 4;
  const padded = padLength ? `${base}${'='.repeat(4 - padLength)}` : base;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signToken(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (expected !== signature) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.uid || !payload.email || !payload.exp) return null;
    if (Date.now() >= Number(payload.exp) * 1000) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function issueToken(user) {
  const nowSec = Math.floor(Date.now() / 1000);
  return signToken({
    uid: user.id,
    email: user.email,
    iat: nowSec,
    exp: nowSec + TOKEN_TTL_SEC
  });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Требуется вход в аккаунт.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, code: 'INVALID_TOKEN', error: 'Сессия истекла. Выполните вход заново.' });
    return;
  }
  const db = await readDb();
  const user = db.users.find((entry) => entry.id === payload.uid && entry.email === payload.email);
  if (!user) {
    res.status(401).json({ ok: false, code: 'USER_NOT_FOUND', error: 'Пользователь не найден.' });
    return;
  }
  req.authToken = token;
  req.authPayload = payload;
  req.db = db;
  req.user = user;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '').trim();
  const name = sanitizeName(req.body?.name, 'Пользователь');

  if (!isEmailValid(email)) {
    res.status(400).json({ ok: false, code: 'INVALID_EMAIL', error: 'Введите корректную почту.' });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: 'Пароль должен содержать минимум 4 символа.' });
    return;
  }

  const db = await readDb();
  const existing = db.users.find((entry) => entry.email === email);
  if (existing) {
    res.status(409).json({ ok: false, code: 'EMAIL_EXISTS', error: 'Пользователь с такой почтой уже зарегистрирован.' });
    return;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const pwd = hashPassword(password);
  const userMeta = { id, email, name };
  const userData = normalizeUserData(req.body?.data, userMeta);

  const user = {
    id,
    email,
    name,
    passwordSalt: pwd.salt,
    passwordHash: pwd.hash,
    createdAt: now,
    updatedAt: now,
    data: userData
  };
  db.users.push(user);
  await writeDb(db);

  res.status(201).json({
    ok: true,
    user: userPublic(user),
    token: issueToken(user),
    data: normalizeUserData(user.data, userMeta)
  });
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '').trim();
  if (!email || !password) {
    res.status(400).json({ ok: false, code: 'MISSING_CREDENTIALS', error: 'Введите почту и пароль.' });
    return;
  }

  const db = await readDb();
  const user = db.users.find((entry) => entry.email === email);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', error: 'Неверная почта или пароль.' });
    return;
  }

  res.json({
    ok: true,
    user: userPublic(user),
    token: issueToken(user),
    data: normalizeUserData(user.data, user)
  });
});

app.get('/api/user/data', requireAuth, async (req, res) => {
  res.json({
    ok: true,
    data: normalizeUserData(req.user.data, req.user)
  });
});

app.put('/api/user/data', requireAuth, async (req, res) => {
  const nextData = req.body?.data;
  if (!nextData || typeof nextData !== 'object') {
    res.status(400).json({ ok: false, code: 'INVALID_DATA', error: 'Передайте данные пользователя.' });
    return;
  }

  const serialized = JSON.stringify(nextData);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_DATA_BYTES) {
    res.status(413).json({ ok: false, code: 'DATA_TOO_LARGE', error: 'Слишком большой объем данных для сохранения.' });
    return;
  }

  const db = req.db;
  const index = db.users.findIndex((entry) => entry.id === req.user.id);
  if (index < 0) {
    res.status(404).json({ ok: false, code: 'USER_NOT_FOUND', error: 'Пользователь не найден.' });
    return;
  }

  const current = db.users[index];
  const normalizedData = normalizeUserData(nextData, current);
  db.users[index] = {
    ...current,
    name: sanitizeName(normalizedData.profile?.name || current.name),
    updatedAt: new Date().toISOString(),
    data: normalizedData
  };
  await writeDb(db);
  res.json({ ok: true, updatedAt: db.users[index].updatedAt });
});

app.get('/vapidPublicKey', (_req, res) => {
  res.json({ publicVapidKey });
});

app.post('/subscribe', async (req, res) => {
  const db = await readDb();
  const subscription = req.body;
  if (!subscription || typeof subscription !== 'object') {
    res.status(400).json({ ok: false, error: 'Некорректная подписка.' });
    return;
  }
  const endpoint = subscription.endpoint;
  if (!endpoint) {
    res.status(400).json({ ok: false, error: 'Некорректная подписка.' });
    return;
  }
  const exists = db.subscriptions.some((entry) => entry.endpoint === endpoint);
  if (!exists) db.subscriptions.push(subscription);
  await writeDb(db);
  res.status(201).json({ ok: true });
});

app.post('/notify', async (req, res) => {
  if (
    publicVapidKey === 'PASTE_YOUR_PUBLIC_KEY'
    || privateVapidKey === 'PASTE_YOUR_PRIVATE_KEY'
  ) {
    res.status(400).json({ ok: false, error: 'VAPID keys are not configured.' });
    return;
  }

  const db = await readDb();
  const payload = JSON.stringify({
    title: req.body?.title || 'CycleFlow',
    body: req.body?.body || 'Напоминание о фазе цикла'
  });
  await Promise.allSettled(db.subscriptions.map((sub) => webpush.sendNotification(sub, payload)));
  res.json({ sent: db.subscriptions.length });
});

app.use(express.static(PUBLIC_DIR));
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const port = Number(process.env.PORT) || 4173;
app.listen(port, () => {
  console.log(`CycleFlow server listening on http://localhost:${port}`);
  console.log(`Users DB: ${DB_PATH}`);
});
