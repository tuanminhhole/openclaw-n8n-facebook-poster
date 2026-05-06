# 📮 openclaw-n8n-facebook-poster

> Plugin OpenClaw để soạn và đăng bài lên Facebook/Threads qua hệ thống N8N. Hỗ trợ soạn nháp multi-turn từ Zalo (text + ảnh), upload ảnh lên CDN công khai, và gửi sang N8N webhook.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue.svg)](https://openclaw.ai)

---

## ✨ Tính năng

| Tính năng | Mô tả |
|-----------|-------|
| **Multi-turn drafting** | Soạn bài qua nhiều tin nhắn (text + ảnh) |
| **Ảnh CDN** | Tự động download và re-upload ảnh Zalo lên Telegraph (public URL) |
| **Multi-webhook** | Cài nhiều webhook riêng cho page/profile, chọn khi gửi |
| **Admin auto-claim** | Người dùng đầu tiên gõ lệnh tự thành Admin |
| **Lưu local** | Bản thảo lưu vào thư mục `content/YYYY-MM-DD/` |

---

## 🏗️ Luồng hoạt động

```
Zalo DM / Group message
    │
    └─ /post-start [kênh]     → Mở bản thảo mới
         │
         ├─ Gửi text/ảnh      → Tích lũy vào bản thảo
         │
         ├─ /post-status      → Xem trạng thái
         ├─ /post-cancel      → Hủy bản thảo
         │
         └─ /post-send [key]  → Download ảnh → Telegraph CDN → Gửi sang N8N
```

---

## 📦 Cài đặt

### 1. Docker (khuyến nghị — dùng với openclaw-setup)

```powershell
docker exec openclaw-bot openclaw plugins install clawhub:openclaw-n8n-facebook-poster --force
docker restart openclaw-bot
```

### 2. Native (không Docker)

```bash
openclaw plugins install openclaw-n8n-facebook-poster
openclaw gateway restart
```

### 3. Cài thủ công từ source

```powershell
# Copy source vào extensions
xcopy /E /I openclaw-n8n-facebook-poster "%OPENCLAW_HOME%\extensions\openclaw-n8n-facebook-poster"

# Hoặc trên Linux
cp -r openclaw-n8n-facebook-poster ~/.openclaw/extensions/openclaw-n8n-facebook-poster

# Restart
openclaw gateway restart
```

### 4. Patch nhanh khi phát triển (Docker)

```powershell
Copy-Item -Path "D:\openclaw-n8n-facebook-poster\index.js" `
  -Destination "E:\final\.openclaw\extensions\openclaw-n8n-facebook-poster\index.js" -Force

docker restart openclaw-bot
```

---

## ⚙️ Cấu hình ban đầu

### Bước 1: Xác nhận plugin đã load

```
[gateway] http server listening (5 plugins: browser, memory-core, openclaw-n8n-facebook-poster, zalo-mod, zalouser; ...)
```

### Bước 2: Tự claim Admin

Gửi bất kỳ lệnh nào trong DM hoặc group (nếu `adminIds` còn trống):
```
/post-start
```
Bot sẽ tự thêm bạn vào `adminIds` và yêu cầu thiết lập webhook.

### Bước 3: Cài đặt Webhook

```
/set-webhook https://your-n8n.com/webhook/luna-post-fb
```

Hoặc cài nhiều webhook theo key:
```
/set-webhook page https://your-n8n.com/webhook/post-page
/set-webhook profile https://your-n8n.com/webhook/post-profile
```

---

## 📋 Danh sách lệnh đầy đủ

### 🔧 Cấu hình (Admin)

| Lệnh | Mô tả |
|------|-------|
| `/set-webhook <url>` | Cài webhook mặc định |
| `/set-webhook <key> <url>` | Cài webhook theo key (vd: `page`, `profile`) |

### 📝 Soạn bài

| Lệnh | Mô tả |
|------|-------|
| `/post-start [kênh]` | Bắt đầu soạn bài (kênh: `Fb`, `Threads`, v.v.) |
| `/post-status` | Xem trạng thái bản thảo hiện tại |
| `/post-cancel` | Hủy bản thảo (cũng nhận: `/post-cancle`, `/post-huy`) |
| `/post-send` | Gửi bài qua webhook mặc định |
| `/post-send <key>` | Gửi bài qua webhook theo key (vd: `/post-send page`) |
| `/post-list` | Xem 10 ngày nội dung đã lưu |

### 📸 Gửi ảnh vào bản thảo

Sau khi `/post-start`, chỉ cần gửi ảnh hoặc link ảnh vào chat — plugin sẽ tự động nhận:
- Ảnh đính kèm Zalo native
- Link ảnh có đuôi `.jpg/.png/.webp`
- Ảnh từ CDN Zalo (`zdn.vn`, `zadn.vn`)

---

## 🔄 Luồng xử lý ảnh

```
Ảnh Zalo (URL ngắn hạn)
    │
    ├─ Download về local (content/YYYY-MM-DD/)
    ├─ Re-upload lên Telegraph (CDN public, không hết hạn)
    └─ Gửi Telegraph URL sang N8N webhook
```

Payload gửi N8N:
```json
{
  "content": "Nội dung bài viết...",
  "channels": "Fb",
  "files": "https://telegra.ph/file/xxx.jpg,https://telegra.ph/file/yyy.jpg"
}
```

---

## 📁 Cấu trúc file lưu trữ

```
{plugin_dir}/
├── config.json          ← Cấu hình admin + webhooks
└── content/
    └── YYYY-MM-DD/
        ├── img_xxx.jpg  ← Ảnh đã tải
        └── draft_xxx.json  ← Bản ghi bài viết
```

`config.json`:
```json
{
  "webhookUrl": "https://...",
  "webhooks": {
    "default": "https://...",
    "page": "https://...",
    "profile": "https://..."
  },
  "adminIds": ["<zalo-user-id>"]
}
```

---

## 🔧 Yêu cầu

- OpenClaw `>= 2026.3.24`
- Channel `zalouser` đã được cấu hình
- N8N instance đang chạy với webhook đã cấu hình
- Node.js `>= 20`

---

## 🔄 Release Workflow

```powershell
# 1. Sửa code
# 2. Cập nhật CHANGELOG.md
# 3. Bump version
node bump-version.js  # hoặc sửa tay package.json
# 4. Commit & push
git add . && git commit -m "chore: release vX.X.X" && git push
# 5. Publish ClawHub
npx clawhub package publish .
```

---

## 📄 License

MIT
