const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  HAWK_BASE_URL: 'https://hawksocia.com',
  HAWK_TOKEN: process.env.HAWK_TOKEN || 'NHAP_TOKEN_CUA_BAN',
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  PORT: process.env.PORT || 3000,
  BANK_ID: 'MSB',
  ACCOUNT_NO: '6817072002',
  ACCOUNT_NAME: 'Nguyen Dang Hai',
  LOOKUP_PRICE: 20000,
  DB_FILE: process.env.DB_FILE || path.join(__dirname, 'db.json'),
  SESSION_TTL: 7 * 24 * 60 * 60 * 1000,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  MAX_HISTORY: 50,
};

// ─── DATABASE ─────────────────────────────────────────────────────────────────
function loadDB() {
  try {
    if (fs.existsSync(CONFIG.DB_FILE)) return JSON.parse(fs.readFileSync(CONFIG.DB_FILE, 'utf8'));
  } catch {}
  return { users: {}, sessions: {} };
}
function saveDB(db) {
  fs.writeFileSync(CONFIG.DB_FILE, JSON.stringify(db, null, 2));
}

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'shopee_salt_2024').digest('hex');
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}
function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
  const db = loadDB();
  const session = db.sessions[token];
  if (!session || Date.now() > session.expiry) {
    return res.status(401).json({ success: false, error: 'Phiên đăng nhập hết hạn' });
  }
  req.uid = session.uid;
  req.username = session.username;
  next();
}
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== CONFIG.ADMIN_PASSWORD) return res.status(403).json({ success: false, error: 'Không có quyền truy cập' });
  next();
}

// ─── HELPER: thêm lịch sử và giới hạn 50 bản ghi ────────────────────────────
function addHistory(user, entry) {
  user.history.unshift(entry);
  if (user.history.length > CONFIG.MAX_HISTORY) {
    user.history = user.history.slice(0, CONFIG.MAX_HISTORY);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password)
    return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ thông tin' });
  if (username.trim().length < 3)
    return res.status(400).json({ success: false, error: 'Tên đăng nhập tối thiểu 3 ký tự' });
  if (password.length < 6)
    return res.status(400).json({ success: false, error: 'Mật khẩu tối thiểu 6 ký tự' });

  const db = loadDB();
  const uname = username.trim().toLowerCase();
  if (Object.values(db.users).find(u => u.username === uname))
    return res.status(409).json({ success: false, error: 'Tên đăng nhập đã tồn tại' });

  const uid = 'uid_' + crypto.randomBytes(8).toString('hex');
  db.users[uid] = {
    uid, username: uname, displayName: username.trim(),
    password: hashPassword(password), balance: 0, history: [],
    createdAt: new Date().toISOString(),
  };
  const token = generateToken();
  db.sessions[token] = { uid, username: uname, expiry: Date.now() + CONFIG.SESSION_TTL };
  saveDB(db);
  res.json({ success: true, token, displayName: username.trim(), balance: 0 });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password)
    return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ thông tin' });

  const db = loadDB();
  const uname = username.trim().toLowerCase();
  const user = Object.values(db.users).find(u => u.username === uname);
  if (!user || user.password !== hashPassword(password))
    return res.status(401).json({ success: false, error: 'Sai tên đăng nhập hoặc mật khẩu' });

  const token = generateToken();
  db.sessions[token] = { uid: user.uid, username: uname, expiry: Date.now() + CONFIG.SESSION_TTL };
  saveDB(db);
  res.json({ success: true, token, displayName: user.displayName, balance: user.balance });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const db = loadDB();
  delete db.sessions[token];
  saveDB(db);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WALLET ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/wallet', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users[req.uid];
  res.json({ success: true, balance: user.balance, history: user.history, displayName: user.displayName });
});

app.post('/api/deposit/qr', requireAuth, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 20000)
    return res.status(400).json({ success: false, error: 'Số tiền tối thiểu 20.000đ' });
  const memo = `NAP ${req.uid}`;
  const qrUrl = `https://img.vietqr.io/image/${CONFIG.BANK_ID}-${CONFIG.ACCOUNT_NO}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(CONFIG.ACCOUNT_NAME)}`;
  res.json({ success: true, qrUrl, amount, memo, bankId: CONFIG.BANK_ID, accountNo: CONFIG.ACCOUNT_NO, accountName: CONFIG.ACCOUNT_NAME });
});

app.get('/api/deposit/check', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ success: true, balance: db.users[req.uid].balance });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT LỊCH SỬ — tải về file .txt hoặc .csv
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/history/export', requireAuth, (req, res) => {
  const { format = 'txt' } = req.query;
  const db = loadDB();
  const user = db.users[req.uid];
  const history = user.history;

  if (!history || history.length === 0) {
    return res.status(404).json({ success: false, error: 'Chưa có lịch sử giao dịch' });
  }

  const now = new Date().toLocaleString('vi-VN');
  const filename = `lichsu_${user.username}_${Date.now()}`;

  if (format === 'csv') {
    let csv = '\uFEFF'; // BOM để Excel hiển thị đúng tiếng Việt
    csv += 'STT,Loại,Mô tả,Số tiền (₫),Thời gian\n';
    history.forEach((h, i) => {
      const type = h.type === 'deposit' ? 'Nạp tiền' :
                   h.type === 'lookup' ? 'Tra cứu' :
                   h.type === 'admin_add' ? 'Admin cộng' : 'Admin trừ';
      const amt = h.amount > 0 ? `+${h.amount}` : `${h.amount}`;
      const time = new Date(h.time).toLocaleString('vi-VN');
      const note = (h.note || '').replace(/,/g, ';');
      csv += `${i + 1},"${type}","${note}","${amt}","${time}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv);
  }

  // Xuất TXT
  let txt = `═══════════════════════════════════════\n`;
  txt += `  LỊCH SỬ GIAO DỊCH — ${user.displayName.toUpperCase()}\n`;
  txt += `═══════════════════════════════════════\n`;
  txt += `Xuất lúc : ${now}\n`;
  txt += `Số dư    : ${user.balance.toLocaleString('vi')} ₫\n`;
  txt += `Tổng GD  : ${history.length} giao dịch (50 gần nhất)\n`;
  txt += `───────────────────────────────────────\n\n`;
  history.forEach((h, i) => {
    const type = h.type === 'deposit' ? '💰 NẠP TIỀN' :
                 h.type === 'lookup' ? '🔍 TRA CỨU' :
                 h.type === 'admin_add' ? '➕ ADMIN CỘNG' : '➖ ADMIN TRỪ';
    const amt = h.amount > 0 ? `+${h.amount.toLocaleString('vi')} ₫` : `${h.amount.toLocaleString('vi')} ₫`;
    const time = new Date(h.time).toLocaleString('vi-VN');
    txt += `[${String(i + 1).padStart(2, '0')}] ${type}\n`;
    txt += `     Mô tả    : ${h.note || '—'}\n`;
    txt += `     Số tiền  : ${amt}\n`;
    txt += `     Thời gian: ${time}\n`;
    txt += `     ─────────────────────────────\n`;
  });
  txt += `\n═══════════════════════════════════════\n`;
  txt += `  trumsope.pro — Shopee Lookup\n`;
  txt += `═══════════════════════════════════════\n`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
  return res.send(txt);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEPAY WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/webhook/sepay', (req, res) => {
  const { transferAmount, description, transferType } = req.body;
  if (transferType !== 'in') return res.json({ success: false });
  const match = description?.match(/NAP\s+(uid_[a-f0-9]+)/i);
  if (!match) return res.json({ success: false });
  const uid = match[1];
  const amount = parseInt(transferAmount) || 0;
  if (amount <= 0) return res.json({ success: false });
  const db = loadDB();
  if (!db.users[uid]) return res.json({ success: false });
  db.users[uid].balance += amount;
  addHistory(db.users[uid], { type: 'deposit', amount, note: 'Nạp tiền qua chuyển khoản', time: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOOKUP ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/check', requireAuth, async (req, res) => {
  const { shopeeUsername } = req.body;
  if (!shopeeUsername?.trim())
    return res.status(400).json({ success: false, error: 'Vui lòng nhập username Shopee' });

  const db = loadDB();
  const user = db.users[req.uid];
  const price = user.customPrice || CONFIG.LOOKUP_PRICE;
  if (user.balance < price) {
    return res.status(402).json({
      success: false, needDeposit: true,
      error: `Số dư không đủ! Cần thêm ${(price - user.balance).toLocaleString('vi')}đ`,
      balance: user.balance, required: price,
    });
  }
  try {
    const response = await axios.post(
      `${CONFIG.HAWK_BASE_URL}/ajaxs/client/rut-tien-ref.php`,
      new URLSearchParams({ token: CONFIG.HAWK_TOKEN, username: shopeeUsername.trim() }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CONFIG.USER_AGENT } }
    );
    const data = response.data;
    let phone = null;
    if (typeof data === 'string') {
      const c = data.trim();
      if (/^0\d{9}$/.test(c) || /^\d{9,11}$/.test(c)) phone = c;
      else { try { const p = JSON.parse(c); phone = p.phone || p.sdt || p.result; } catch {} if (!phone) phone = c; }
    } else if (data && typeof data === 'object') {
      phone = data.phone || data.sdt || data.phone_number || data.result;
    }
    if (!phone || phone === '0' || phone === 'false' || phone === '') {
      return res.json({ success: false, error: 'Không tìm thấy thông tin. Tiền không bị trừ.' });
    }
    user.balance -= price;
    addHistory(user, { type: 'lookup', amount: -price, note: `Tra cứu: ${shopeeUsername.trim()} → ${phone}`, time: new Date().toISOString() });
    saveDB(db);
    res.json({ success: true, phone, shopeeUsername: shopeeUsername.trim(), balance: user.balance, price });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: 'Lỗi kết nối máy chủ tra cứu' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== CONFIG.ADMIN_PASSWORD)
    return res.status(403).json({ success: false, error: 'Sai mật khẩu' });
  res.json({ success: true, key: CONFIG.ADMIN_PASSWORD });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const db = loadDB();
  const users = Object.values(db.users);
  const allHistory = users.flatMap(u => u.history);
  res.json({
    success: true,
    stats: {
      totalUsers: users.length,
      totalBalance: users.reduce((s, u) => s + u.balance, 0),
      totalDeposited: allHistory.filter(h => h.type === 'deposit').reduce((s, h) => s + h.amount, 0),
      totalLookups: allHistory.filter(h => h.type === 'lookup').length,
      totalRevenue: allHistory.filter(h => h.type === 'lookup').length * CONFIG.LOOKUP_PRICE,
    }
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const db = loadDB();
  const users = Object.values(db.users).map(u => ({
    uid: u.uid, username: u.username, displayName: u.displayName,
    balance: u.balance, createdAt: u.createdAt,
    totalDeposit: u.history.filter(h => h.type === 'deposit').reduce((s, h) => s + h.amount, 0),
    totalLookup: u.history.filter(h => h.type === 'lookup').length,
    lastActivity: u.history[0]?.time || u.createdAt,
    customPrice: u.customPrice || null,
  }));
  users.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  res.json({ success: true, users });
});

app.get('/api/admin/users/:uid', requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users[req.params.uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  res.json({ success: true, user });
});

app.post('/api/admin/balance', requireAdmin, (req, res) => {
  const { uid, amount, note } = req.body;
  if (!uid || !amount || amount === 0)
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  const prev = user.balance;
  user.balance = Math.max(0, user.balance + amount);
  addHistory(user, { type: amount > 0 ? 'admin_add' : 'admin_deduct', amount, note: note || (amount > 0 ? 'Admin cộng tiền' : 'Admin trừ tiền'), time: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, prevBalance: prev, newBalance: user.balance, username: user.username });
});

app.post('/api/admin/balance/set', requireAdmin, (req, res) => {
  const { uid, balance, note } = req.body;
  if (!uid || balance === undefined || balance < 0)
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  const prev = user.balance;
  const diff = balance - prev;
  user.balance = balance;
  addHistory(user, { type: diff >= 0 ? 'admin_add' : 'admin_deduct', amount: diff, note: note || `Admin đặt số dư: ${balance.toLocaleString('vi')}đ`, time: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, prevBalance: prev, newBalance: balance, username: user.username });
});

app.post('/api/admin/price', requireAdmin, (req, res) => {
  const { uid, price } = req.body;
  if (!uid || price === undefined || price < 0)
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  if (price === 0 || price === null) {
    delete user.customPrice;
  } else {
    user.customPrice = price;
  }
  saveDB(db);
  res.json({ success: true, username: user.username, customPrice: user.customPrice || null });
});

app.delete('/api/admin/users/:uid', requireAdmin, (req, res) 
