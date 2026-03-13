# Shopee Lookup — Hướng dẫn Deploy

## Cấu trúc file
```
shopee-lookup/
├── server.js              ← Backend Node.js (toàn bộ API)
├── package.json           ← Dependencies
├── db.json                ← Tự tạo khi chạy (dữ liệu users/ví)
└── public/
    ├── index.html         ← Trang đăng nhập / đăng ký
    ├── checkso.html       ← Trang tra cứu SĐT (cần đăng nhập)
    └── admin.html         ← Trang quản trị (mật khẩu riêng)
```

---

## Deploy lên Railway (khuyến nghị)

### Bước 1: Tạo GitHub repo
Upload toàn bộ folder lên GitHub repo mới.

### Bước 2: Deploy Railway
1. Vào railway.app → New Project → Deploy from GitHub
2. Chọn repo vừa tạo

### Bước 3: Thêm biến môi trường (Railway → Variables)
```
HAWK_TOKEN      = token_hawksocia_cua_ban
ADMIN_PASSWORD  = matkhau_admin_manh
PORT            = 3000
DB_FILE         = /app/data/db.json
```

### Bước 4: Thêm Volume (giữ dữ liệu khi redeploy)
Railway → Add Volume → Mount path: /app/data

### Bước 5: Gắn domain taphoammo.click
- Railway → Settings → Networking → Custom Domain → nhập taphoammo.click
- Copy CNAME Railway cấp
- Netlify → Domains → taphoammo.click → DNS Settings → Add CNAME record

---

## Chạy local (test)
```bash
npm install
HAWK_TOKEN=xxx ADMIN_PASSWORD=xxx npm start
```
Mở: http://localhost:3000

---

## Webhook SePay (tự động nạp tiền)
1. Đăng ký tại sepay.vn (miễn phí)
2. Kết nối tài khoản MSB
3. Webhook URL: https://taphoammo.click/webhook/sepay

---

## Các trang
| URL | Mô tả |
|-----|-------|
| taphoammo.click | Đăng nhập / Đăng ký |
| taphoammo.click/checkso.html | Tra cứu SĐT (cần login) |
| taphoammo.click/admin.html | Quản trị (ADMIN_PASSWORD) |
