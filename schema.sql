-- 访问请求表（匹配 request-access.js 使用 Cloudflare Access email）
DROP TABLE IF EXISTS access_requests;
DROP TABLE IF EXISTS sessions;

CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',  -- pending / approved / denied
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 会话表（用于管理登录状态）
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
