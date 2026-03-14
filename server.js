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
  ACCOUNT_NO: '80001375838',
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
  const price = user.customPrice || CONFIG.LOOKUP_PRICE;
  res.json({ success: true, balance: user.balance, history: user.history, displayName: user.displayName, price });
});

app.post('/api/deposit/qr', requireAuth, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 20000)
    return res.status(400).json({ success: false, error: 'Số tiền tối thiểu 20.000đ' });
  const memo = 'NAP ' + req.uid;
  const qrUrl = 'https://img.vietqr.io/image/' + CONFIG.BANK_ID + '-' + CONFIG.ACCOUNT_NO + '-compact2.png?amount=' + amount + '&addInfo=' + encodeURIComponent(memo) + '&accountName=' + encodeURIComponent(CONFIG.ACCOUNT_NAME);
  res.json({ success: true, qrUrl, amount, memo, bankId: CONFIG.BANK_ID, accountNo: CONFIG.ACCOUNT_NO, accountName: CONFIG.ACCOUNT_NAME });
});

app.get('/api/deposit/check', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ success: true, balance: db.users[req.uid].balance });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT LỊCH SỬ
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/history/export', requireAuth, (req, res) => {
  const format = req.query.format || 'txt';
  const db = loadDB();
  const user = db.users[req.uid];
  const history = user.history;

  if (!history || history.length === 0) {
    return res.status(404).json({ success: false, error: 'Chưa có lịch sử giao dịch' });
  }

  const now = new Date().toLocaleString('vi-VN');
  const filename = 'lichsu_' + user.username + '_' + Date.now();

  if (format === 'csv') {
    let csv = '\uFEFF';
    csv += 'STT,Loại,Mô tả,Số tiền (đ),Thời gian\n';
    history.forEach(function(h, i) {
      const type = h.type === 'deposit' ? 'Nạp tiền' :
                   h.type === 'lookup' ? 'Tra cứu' :
                   h.type === 'admin_add' ? 'Admin cộng' : 'Admin trừ';
      const amt = h.amount > 0 ? '+' + h.amount : '' + h.amount;
      const time = new Date(h.time).toLocaleString('vi-VN');
      const note = (h.note || '').replace(/,/g, ';');
      csv += (i + 1) + ',"' + type + '","' + note + '","' + amt + '","' + time + '"\n';
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '.csv"');
    return res.send(csv);
  }

  let txt = '═══════════════════════════════════════\n';
  txt += '  LỊCH SỬ GIAO DỊCH — ' + user.displayName.toUpperCase() + '\n';
  txt += '═══════════════════════════════════════\n';
  txt += 'Xuất lúc : ' + now + '\n';
  txt += 'Số dư    : ' + user.balance.toLocaleString('vi') + ' đ\n';
  txt += 'Tổng GD  : ' + history.length + ' giao dịch (50 gần nhất)\n';
  txt += '───────────────────────────────────────\n\n';
  history.forEach(function(h, i) {
    const type = h.type === 'deposit' ? 'NẠP TIỀN' :
                 h.type === 'lookup' ? 'TRA CỨU' :
                 h.type === 'admin_add' ? 'ADMIN CỘNG' : 'ADMIN TRỪ';
    const amt = h.amount > 0 ? '+' + h.amount.toLocaleString('vi') + ' đ' : h.amount.toLocaleString('vi') + ' đ';
    const time = new Date(h.time).toLocaleString('vi-VN');
    const idx = String(i + 1).padStart(2, '0');
    txt += '[' + idx + '] ' + type + '\n';
    txt += '     Mô tả    : ' + (h.note || '—') + '\n';
    txt += '     Số tiền  : ' + amt + '\n';
    txt += '     Thời gian: ' + time + '\n';
    txt += '     ─────────────────────────────\n';
  });
  txt += '\n═══════════════════════════════════════\n';
  txt += '  trumsope.pro — Shopee Lookup\n';
  txt += '═══════════════════════════════════════\n';

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '.txt"');
  return res.send(txt);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEPAY WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/webhook/sepay', (req, res) => {
  const transferAmount = req.body.transferAmount;
  const description = req.body.description;
  const content = req.body.content;
  const transferType = req.body.transferType;
  if (transferType !== 'in') return res.json({ success: false });
  // Tìm uid trong cả description lẫn content (SePay có thể gửi ở 1 trong 2)
  const searchText = (description || '') + ' ' + (content || '');
  const match = searchText.match(/NAP\s+(uid_?[a-f0-9]+)/i);
  if (!match) return res.json({ success: false });
  // Chuẩn hóa uid: đảm bảo có dạng uid_xxxxxx
  const rawUid = match[1];
  const uid = rawUid.startsWith('uid_') ? rawUid : 'uid_' + rawUid.slice(3);
  const amount = parseInt(transferAmount) || 0;
  if (amount <= 0) return res.json({ success: false });
  const db = loadDB();
  if (!db.users[uid]) return res.json({ success: false });
  db.users[uid].balance += amount;
  addHistory(db.users[uid], { type: 'deposit', amount: amount, note: 'Nạp tiền qua chuyển khoản', time: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOOKUP ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/check', requireAuth, async (req, res) => {
  const shopeeUsername = req.body.shopeeUsername;
  if (!shopeeUsername || !shopeeUsername.trim())
    return res.status(400).json({ success: false, error: 'Vui lòng nhập username Shopee' });

  const db = loadDB();
  const user = db.users[req.uid];
  const price = user.customPrice || CONFIG.LOOKUP_PRICE;

  if (user.balance < price) {
    return res.status(402).json({
      success: false,
      needDeposit: true,
      error: 'Số dư không đủ! Cần thêm ' + (price - user.balance).toLocaleString('vi') + 'đ',
      balance: user.balance,
      required: price,
    });
  }

  try {
    // Bước 1: Gửi yêu cầu tra cứu
    const step1 = await axios.post(
      CONFIG.HAWK_BASE_URL + '/ajaxs/client/rut-tien-ref.php',
      new URLSearchParams({ token: CONFIG.HAWK_TOKEN, username: shopeeUsername.trim() }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CONFIG.USER_AGENT } }
    );
    console.log('[HAWK] Step1:', JSON.stringify(step1.data).substring(0, 200));

    // Kiểm tra bước 1 có thành công không
    const s1 = step1.data;
    const s1ok = (typeof s1 === 'object' && s1.status === 'success') ||
                 (typeof s1 === 'string' && s1.includes('thành công'));
    if (!s1ok) {
      console.log('[HAWK] Step1 failed:', JSON.stringify(s1));
      return res.json({ success: false, error: 'Không tìm thấy thông tin. Tiền không bị trừ.' });
    }

    // Bước 2: Chờ 2 giây rồi lấy kết quả từ lịch sử
    await new Promise(resolve => setTimeout(resolve, 2000));
    const step2 = await axios.get(
      CONFIG.HAWK_BASE_URL + '/client/affiliates',
      {
        headers: { 'User-Agent': CONFIG.USER_AGENT },
        withCredentials: true,
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Cookie': 'user_login=' + CONFIG.HAWK_TOKEN + '; user_agent=' + encodeURIComponent(CONFIG.USER_AGENT)
        }
      }
    );
    const html = step2.data;
    console.log('[HAWK] Step2 HTML length:', html.length);
    // Log 2000 ký tự giữa HTML để xem cấu trúc bảng
    const midIdx = Math.floor(html.length / 2);
    console.log('[HAWK] HTML sample:', html.substring(midIdx, midIdx + 800).replace(/\s+/g, ' '));

    // Parse HTML tìm số điện thoại theo username
    let phone = null;
    const targetUser = shopeeUsername.trim().toLowerCase();
    // Tìm pattern: <td>username</td> ... <td>phone</td>
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRegex) || [];
    for (const row of rows) {
      const tdMatches = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const tds = tdMatches.map(td => td.replace(/<[^>]+>/g, '').trim());
      if (tds.length >= 3 && tds[0].toLowerCase() === targetUser) {
        const possiblePhone = tds[tds.length - 1];
        if (/^0\d{8,10}$/.test(possiblePhone) || /^\d{9,11}$/.test(possiblePhone)) {
          phone = possiblePhone;
          break;
        }
      }
    }

    // Fallback: tìm số điện thoại gần username trong toàn bộ HTML
    if (!phone) {
      const userIdx = html.toLowerCase().indexOf(targetUser);
      if (userIdx !== -1) {
        const nearby = html.substring(userIdx, userIdx + 500);
        const phoneMatch = nearby.match(/0\d{9}/);
        if (phoneMatch) phone = phoneMatch[0];
      }
    }

    console.log('[HAWK] phone found:', phone);

    if (!phone) {
      return res.json({ success: false, error: 'Không tìm thấy số điện thoại. Tiền không bị trừ.' });
    }

    user.balance -= price;
    addHistory(user, { type: 'lookup', amount: -price, note: 'Tra cứu: ' + shopeeUsername.trim() + ' → ' + phone, time: new Date().toISOString() });
    saveDB(db);
    res.json({ success: true, phone: phone, shopeeUsername: shopeeUsername.trim(), balance: user.balance, price: price });
  } catch (err) {
    console.error('[HAWK] Error:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi kết nối máy chủ tra cứu' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  const password = req.body.password;
  if (password !== CONFIG.ADMIN_PASSWORD)
    return res.status(403).json({ success: false, error: 'Sai mật khẩu' });
  res.json({ success: true, key: CONFIG.ADMIN_PASSWORD });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const db = loadDB();
  const users = Object.values(db.users);
  const allHistory = users.reduce(function(arr, u) { return arr.concat(u.history); }, []);
  res.json({
    success: true,
    stats: {
      totalUsers: users.length,
      totalBalance: users.reduce(function(s, u) { return s + u.balance; }, 0),
      totalDeposited: allHistory.filter(function(h) { return h.type === 'deposit'; }).reduce(function(s, h) { return s + h.amount; }, 0),
      totalLookups: allHistory.filter(function(h) { return h.type === 'lookup'; }).length,
      totalRevenue: allHistory.filter(function(h) { return h.type === 'lookup'; }).length * CONFIG.LOOKUP_PRICE,
    }
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const db = loadDB();
  const users = Object.values(db.users).map(function(u) {
    return {
      uid: u.uid,
      username: u.username,
      displayName: u.displayName,
      balance: u.balance,
      createdAt: u.createdAt,
      customPrice: u.customPrice || null,
      totalDeposit: u.history.filter(function(h) { return h.type === 'deposit'; }).reduce(function(s, h) { return s + h.amount; }, 0),
      totalLookup: u.history.filter(function(h) { return h.type === 'lookup'; }).length,
      lastActivity: u.history[0] ? u.history[0].time : u.createdAt,
    };
  });
  users.sort(function(a, b) { return new Date(b.lastActivity) - new Date(a.lastActivity); });
  res.json({ success: true, users: users });
});

app.get('/api/admin/users/:uid', requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users[req.params.uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  res.json({ success: true, user: user });
});

app.post('/api/admin/balance', requireAdmin, (req, res) => {
  const uid = req.body.uid;
  const amount = req.body.amount;
  const note = req.body.note;
  if (!uid || !amount || amount === 0)
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  const prev = user.balance;
  user.balance = Math.max(0, user.balance + amount);
  addHistory(user, { type: amount > 0 ? 'admin_add' : 'admin_deduct', amount: amount, note: note || (amount > 0 ? 'Admin cộng tiền' : 'Admin trừ tiền'), time: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, prevBalance: prev, newBalance: user.balance, username: user.username });
});

app.post('/api/admin/balance/set', requireAdmin, (req, res) => {
  const uid = req.body.uid;
  const balance = req.body.balance;
  const note = req.body.note;
  if (!uid || balance === undefined || balance < 0)
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  const prev = user.balance;
  const diff = balance - prev;
  user.balance = balance;
  addHistory(user, { type: diff >= 0 ? 'admin_add' : 'admin_deduct', amount: diff, note: note || ('Admin đặt số dư: ' + balance.toLocaleString('vi') + 'đ'), time: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, prevBalance: prev, newBalance: balance, username: user.username });
});

// ─── ADMIN: ĐẶT GIÁ RIÊNG CHO USER ──────────────────────────────────────────
app.post('/api/admin/price', requireAdmin, (req, res) => {
  const uid = req.body.uid;
  const price = req.body.price;
  if (!uid || price === undefined || price < 0)
    return res.status(400).json({ success: false, error: 'Thiếu thông tin' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  if (!price || price === 0) {
    delete user.customPrice;
  } else {
    user.customPrice = price;
  }
  saveDB(db);
  res.json({ success: true, username: user.username, customPrice: user.customPrice || null });
});


// ─── ADMIN: ĐỔI MẬT KHẨU USER ───────────────────────────────────────────────
app.post('/api/admin/reset-password', requireAdmin, (req, res) => {
  const uid = req.body.uid;
  const newPassword = req.body.newPassword;
  if (!uid || !newPassword || newPassword.length < 6)
    return res.status(400).json({ success: false, error: 'Mật khẩu tối thiểu 6 ký tự' });
  const db = loadDB();
  const user = db.users[uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  user.password = hashPassword(newPassword);
  saveDB(db);
  res.json({ success: true, username: user.username });
});

// ─── ADMIN: THÔNG BÁO ĐỘNG ───────────────────────────────────────────────────
app.get('/api/announcement', (req, res) => {
  const db = loadDB();
  res.json({ success: true, announcement: db.announcement || null });
});

app.post('/api/admin/announcement', requireAdmin, (req, res) => {
  const text = req.body.text || '';
  const type = req.body.type || 'info'; // info, warning, success
  const db = loadDB();
  if (!text.trim()) {
    db.announcement = null;
  } else {
    db.announcement = { text: text.trim(), type, updatedAt: new Date().toISOString() };
  }
  saveDB(db);
  res.json({ success: true, announcement: db.announcement });
});

// ─── ADMIN: GIẢM GIÁ HÀNG LOẠT ──────────────────────────────────────────────
app.post('/api/admin/price/bulk', requireAdmin, (req, res) => {
  const price = req.body.price;
  const reset = req.body.reset;
  const db = loadDB();
  let count = 0;
  Object.values(db.users).forEach(function(user) {
    if (reset) {
      delete user.customPrice;
    } else {
      user.customPrice = price;
    }
    count++;
  });
  saveDB(db);
  res.json({ success: true, count, price: reset ? null : price });
});

app.delete('/api/admin/users/:uid', requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users[req.params.uid];
  if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
  const username = user.username;
  delete db.users[req.params.uid];
  saveDB(db);
  res.json({ success: true, username: username });
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(CONFIG.PORT, function() {
  console.log('🚀 Server: http://localhost:' + CONFIG.PORT);
  console.log('📋 MAX_HISTORY: ' + CONFIG.MAX_HISTORY + ' bản ghi/user');
});
