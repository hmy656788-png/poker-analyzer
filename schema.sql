-- 丢弃旧表
DROP TABLE IF EXISTS access_requests;
DROP TABLE IF EXISTS sessions;

-- 访问请求/用户表
CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',  -- pending / approved / denied
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 会话表（用于管理登录状态，简单起见存储 token）
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 插入一条默认的绝对超级管理员记录，默认 approved
-- 密码明文: admin123 (仅作演示，为了极致简单这里直接存，不引入bcrypt等库)
INSERT INTO access_requests (username, password, reason, status)
VALUES ('admin', 'admin123', 'Super Admin Override', 'approved');
