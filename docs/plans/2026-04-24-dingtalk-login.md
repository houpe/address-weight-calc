# 钉钉登录功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为地址坐标可靠度计算器添加钉钉登录功能，支持扫码登录和钉钉内免登，实现简单权限控制。

**Architecture:** 使用 express-session 管理会话，SQLite 存储用户数据，通过钉钉开放平台 OAuth 2.0 实现身份认证。

**Tech Stack:** Node.js, Express, express-session, better-sqlite3, 钉钉开放平台 API

---

## 环境变量配置

已获取钉钉应用凭证：
- `DINGTALK_APP_KEY`: `dingj7jagakjrccgceq3`
- `DINGTALK_APP_SECRET`: `cGSjUwLcQ4xrDOxH2mE5Rye2RemUnCihGqqo4M9dDlZ6psvq41ki0WBhozWpRrEQ`

---

### Task 1: 安装依赖并更新环境变量

**Files:**
- Modify: `.env`
- Modify: `.env.example`
- Modify: `package.json`

**Step 1: 安装 express-session**

```bash
npm install express-session
```

**Step 2: 更新 .env 文件**

在 `.env` 末尾添加：

```
DINGTALK_APP_KEY=dingj7jagakjrccgceq3
DINGTALK_APP_SECRET=cGSjUwLcQ4xrDOxH2mE5Rye2RemUnCihGqqo4M9dDlZ6psvq41ki0WBhozWpRrEQ
SESSION_SECRET=dingtalk-session-secret-key-2024
```

**Step 3: 更新 .env.example 文件**

在 `.env.example` 末尾添加：

```
DINGTALK_APP_KEY=your_dingtalk_app_key
DINGTALK_APP_SECRET=your_dingtalk_app_secret
SESSION_SECRET=your_random_session_secret
```

**Step 4: 验证安装**

```bash
npm list express-session
```

Expected: 显示 express-session 版本

---

### Task 2: 创建数据库表

**Files:**
- Modify: `server.js`

**Step 1: 在 server.js 中添加用户表和登录日志表**

在 `db.exec` 调用后添加：

```javascript
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ding_user_id TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar TEXT,
  unionid TEXT,
  is_admin INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  login_type TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);
```

位置：在 `db.pragma('journal_mode = WAL');` 之前

**Step 2: 重启服务器验证**

```bash
sqlite3 cache.db ".schema users"
```

Expected: 显示 users 表结构

---

### Task 3: 配置 Session 中间件

**Files:**
- Modify: `server.js`

**Step 1: 导入 session 依赖**

在文件顶部 require 语句后添加：

```javascript
const session = require('express-session');
```

**Step 2: 配置 session 中间件**

在 `app.use(express.json());` 之后添加：

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));
```

**Step 3: 重启服务器验证无错误**

```bash
node server.js
```

Expected: 服务器正常启动，无报错

---

### Task 4: 创建钉钉 API 工具函数

**Files:**
- Create: `dingtalk.js`

**Step 1: 创建 dingtalk.js 文件**

```javascript
const axios = require('axios');

const DINGTALK_APP_KEY = process.env.DINGTALK_APP_KEY;
const DINGTALK_APP_SECRET = process.env.DINGTALK_APP_SECRET;

let cachedToken = null;
let tokenExpireTime = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpireTime) {
    return cachedToken;
  }
  
  const res = await axios.get('https://oapi.dingtalk.com/gettoken', {
    params: {
      appkey: DINGTALK_APP_KEY,
      appsecret: DINGTALK_APP_SECRET
    },
    timeout: 10000
  });
  
  if (res.data.errcode !== 0) {
    throw new Error(res.data.errmsg);
  }
  
  cachedToken = res.data.access_token;
  tokenExpireTime = now + (res.data.expires_in - 300) * 1000;
  return cachedToken;
}

async function getUserByAuthCode(authCode) {
  const accessToken = await getAccessToken();
  
  const res = await axios.post(
    'https://oapi.dingtalk.com/topapi/v2/user/getuserinfo',
    { code: authCode },
    {
      params: { access_token: accessToken },
      timeout: 10000
    }
  );
  
  if (res.data.errcode !== 0) {
    throw new Error(res.data.errmsg);
  }
  
  const userId = res.data.result.userid;
  
  const userRes = await axios.post(
    'https://oapi.dingtalk.com/topapi/v2/user/get',
    { userid: userId },
    {
      params: { access_token: accessToken },
      timeout: 10000
    }
  );
  
  if (userRes.data.errcode !== 0) {
    throw new Error(userRes.data.errmsg);
  }
  
  return {
    userId: userId,
    name: userRes.data.result.name,
    avatar: userRes.data.result.avatar,
    unionid: userRes.data.result.unionid
  };
}

async function getQrConnectUrl(redirectUri, state) {
  const redirect = encodeURIComponent(redirectUri);
  return `https://login.dingtalk.com/oauth2/auth?redirect_uri=${redirect}&client_id=${DINGTALK_APP_KEY}&response_type=code&scope=openid&state=${state}&prompt=consent`;
}

async function getUserByCode(code) {
  const tokenRes = await axios.post(
    'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
    {
      clientId: DINGTALK_APP_KEY,
      clientSecret: DINGTALK_APP_SECRET,
      code: code,
      grantType: 'authorization_code'
    },
    { timeout: 10000 }
  );
  
  const accessToken = tokenRes.data.accessToken;
  
  const userRes = await axios.get(
    'https://api.dingtalk.com/v1.0/contact/users/me',
    {
      headers: { 'x-acs-dingtalk-access-token': accessToken },
      timeout: 10000
    }
  );
  
  return {
    userId: userRes.data.openId,
    name: userRes.data.nickName,
    avatar: userRes.data.avatarUrl,
    unionid: userRes.data.unionId
  };
}

module.exports = {
  getAccessToken,
  getUserByAuthCode,
  getQrConnectUrl,
  getUserByCode
};
```

**Step 2: 验证文件创建**

```bash
ls -la dingtalk.js
```

Expected: 文件存在

---

### Task 5: 创建认证中间件

**Files:**
- Modify: `server.js`

**Step 1: 添加认证中间件函数**

在路由定义之前添加：

```javascript
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  if (!req.session.user.isAdmin) {
    return res.status(403).json({ error: '无权限' });
  }
  next();
}
```

---

### Task 6: 实现认证路由

**Files:**
- Modify: `server.js`

**Step 1: 导入 dingtalk 模块**

在文件顶部添加：

```javascript
const dingtalk = require('./dingtalk');
```

**Step 2: 添加认证路由**

在现有路由之后添加：

```javascript
const crypto = require('crypto');

const loginStates = new Map();

app.get('/api/auth/dingtalk/url', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const redirect = req.query.redirect || '/';
  loginStates.set(state, { redirect, created: Date.now() });
  
  setTimeout(() => loginStates.delete(state), 5 * 60 * 1000);
  
  const host = req.get('host');
  const protocol = req.protocol;
  const callbackUrl = `${protocol}://${host}/api/auth/dingtalk/callback`;
  const url = dingtalk.getQrConnectUrl(callbackUrl, state);
  
  res.json({ url, state });
});

app.get('/api/auth/dingtalk/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code || !state) {
    return res.status(400).send('缺少参数');
  }
  
  const stateData = loginStates.get(state);
  if (!stateData) {
    return res.status(400).send('state 已过期');
  }
  loginStates.delete(state);
  
  try {
    const userInfo = await dingtalk.getUserByCode(code);
    
    let user = db.prepare('SELECT * FROM users WHERE ding_user_id = ?').get(userInfo.userId);
    
    if (!user) {
      const insert = db.prepare('INSERT INTO users (ding_user_id, name, avatar, unionid) VALUES (?, ?, ?, ?)');
      insert.run(userInfo.userId, userInfo.name, userInfo.avatar, userInfo.unionid);
      user = db.prepare('SELECT * FROM users WHERE ding_user_id = ?').get(userInfo.userId);
    } else {
      db.prepare('UPDATE users SET name = ?, avatar = ?, unionid = ? WHERE ding_user_id = ?')
        .run(userInfo.name, userInfo.avatar, userInfo.unionid, userInfo.userId);
    }
    
    db.prepare('INSERT INTO login_logs (user_id, login_type, ip, user_agent) VALUES (?, ?, ?, ?)')
      .run(user.id, 'qr', req.ip, req.get('user-agent'));
    
    req.session.user = {
      id: user.id,
      dingUserId: user.ding_user_id,
      name: user.name,
      avatar: user.avatar,
      isAdmin: user.is_admin === 1
    };
    
    res.redirect(stateData.redirect);
  } catch (e) {
    console.error('钉钉登录失败:', e);
    res.status(500).send('登录失败: ' + e.message);
  }
});

app.post('/api/auth/dingtalk/auto', async (req, res) => {
  const { authCode } = req.body;
  
  if (!authCode) {
    return res.status(400).json({ error: '缺少 authCode' });
  }
  
  try {
    const userInfo = await dingtalk.getUserByAuthCode(authCode);
    
    let user = db.prepare('SELECT * FROM users WHERE ding_user_id = ?').get(userInfo.userId);
    
    if (!user) {
      const insert = db.prepare('INSERT INTO users (ding_user_id, name, avatar, unionid) VALUES (?, ?, ?, ?)');
      insert.run(userInfo.userId, userInfo.name, userInfo.avatar, userInfo.unionid);
      user = db.prepare('SELECT * FROM users WHERE ding_user_id = ?').get(userInfo.userId);
    } else {
      db.prepare('UPDATE users SET name = ?, avatar = ?, unionid = ? WHERE ding_user_id = ?')
        .run(userInfo.name, userInfo.avatar, userInfo.unionid, userInfo.userId);
    }
    
    db.prepare('INSERT INTO login_logs (user_id, login_type, ip, user_agent) VALUES (?, ?, ?, ?)')
      .run(user.id, 'auto', req.ip, req.get('user-agent'));
    
    req.session.user = {
      id: user.id,
      dingUserId: user.ding_user_id,
      name: user.name,
      avatar: user.avatar,
      isAdmin: user.is_admin === 1
    };
    
    res.json({ success: true, user: req.session.user });
  } catch (e) {
    console.error('钉钉免登失败:', e);
    res.status(500).json({ error: '登录失败: ' + e.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false, user: null });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: '退出失败' });
    }
    res.json({ success: true });
  });
});
```

**Step 3: 重启服务器验证**

```bash
node server.js
```

Expected: 服务器正常启动

---

### Task 7: 创建登录页面

**Files:**
- Create: `login.html`

**Step 1: 创建 login.html 文件**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - 地址坐标可靠度计算器</title>
  <script src="https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js"></script>
  <style>
    :root {
      --bg: #0f172a; --surface: #1e293b; --border: #475569;
      --text: #f1f5f9; --text-dim: #94a3b8; --accent: #38bdf8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, 'SF Pro', 'PingFang SC', sans-serif;
      background: var(--bg); color: var(--text);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .login-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 32px; width: 360px;
      text-align: center;
    }
    .logo { font-size: 32px; margin-bottom: 8px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: var(--text-dim); margin-bottom: 24px; }
    #qr-container { margin: 20px 0; min-height: 200px; }
    .loading { color: var(--text-dim); font-size: 13px; }
    .error { color: #f87171; font-size: 13px; margin-top: 16px; }
    .hint { font-size: 11px; color: var(--text-dim); margin-top: 16px; }
    .back-link { 
      display: block; margin-top: 16px; color: var(--accent); 
      text-decoration: none; font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo">📍</div>
    <h1>地址坐标可靠度计算器</h1>
    <div class="subtitle">请使用钉钉扫码登录</div>
    <div id="qr-container"><div class="loading">加载中...</div></div>
    <div id="error-msg" class="error" style="display:none;"></div>
    <div class="hint">仅限企业内部员工使用</div>
    <a href="/" class="back-link">返回首页</a>
  </div>

  <script>
    const redirect = new URLSearchParams(location.search).get('redirect') || '/';
    let isInDingTalk = false;

    function checkDingTalkEnv() {
      const ua = navigator.userAgent.toLowerCase();
      return ua.includes('dingtalk');
    }

    async function tryAutoLogin() {
      try {
        const dt = window.dt || window.dingtalk || {};
        if (!dt.runtime || !dt.runtime.permission) {
          throw new Error('钉钉环境不可用');
        }
        
        const code = await new Promise((resolve, reject) => {
          dt.runtime.permission.requestAuthCode({
            onSuccess: res => resolve(res.code),
            onFail: err => reject(err)
          });
        });

        const res = await fetch('/api/auth/dingtalk/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authCode: code })
        });

        const data = await res.json();
        if (data.success) {
          location.href = redirect;
        } else {
          throw new Error(data.error);
        }
      } catch (e) {
        console.error('免登失败:', e);
        showQrLogin();
      }
    }

    async function showQrLogin() {
      try {
        const res = await fetch('/api/auth/dingtalk/url?redirect=' + encodeURIComponent(redirect));
        const data = await res.json();

        const container = document.getElementById('qr-container');
        container.innerHTML = '';

        const url = new URL(data.url);
        const login = new DDLogin({
          id: 'qr-container',
          goto: url.searchParams.get('redirect_uri'),
          style: 'border:none;background-color:#1e293b;',
          href: 'data:text/css;base64,' + btoa(`
            .login-container { background: transparent; }
            .login-title { display: none; }
          `)
        });
      } catch (e) {
        document.getElementById('error-msg').textContent = '加载登录二维码失败: ' + e.message;
        document.getElementById('error-msg').style.display = 'block';
      }
    }

    async function init() {
      isInDingTalk = checkDingTalkEnv();

      if (isInDingTalk) {
        const script = document.createElement('script');
        script.src = 'https://g.alicdn.com/dingding/dingtalk-jsapi/2.10.3/dingtalk.open.js';
        script.onload = tryAutoLogin;
        script.onerror = showQrLogin;
        document.body.appendChild(script);
      } else {
        showQrLogin();
      }
    }

    init();
  </script>
</body>
</html>
```

**Step 2: 验证文件创建**

```bash
ls -la login.html
```

Expected: 文件存在

---

### Task 8: 修改首页添加登录状态检查

**Files:**
- Modify: `index.html`

**Step 1: 在 body 顶部添加登录检查脚本**

在 `<body>` 标签后，`.container` 之前添加：

```html
  <script>
    (async function() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        window.__currentUser = data.user;
        
        if (!data.loggedIn) {
          const current = location.pathname + location.search;
          if (current !== '/' && current !== '/index.html') {
            location.href = '/login.html?redirect=' + encodeURIComponent(current);
          }
        }
      } catch (e) {
        console.error('获取用户信息失败:', e);
      }
    })();
  </script>
```

**Step 2: 在 header 区域添加用户信息显示**

找到 `.header` 部分，修改为：

```html
    <div class="header">
      <h1>📍 地址坐标可靠度计算器</h1>
      <span class="sub">多源融合 · 置信评估</span>
      <div id="user-info" style="margin-left:auto;display:flex;align-items:center;gap:8px;">
        <span id="user-name" style="font-size:12px;color:var(--text-dim);"></span>
        <img id="user-avatar" style="width:28px;height:28px;border-radius:50%;display:none;" />
        <button id="logout-btn" style="display:none;padding:4px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text-dim);font-size:11px;cursor:pointer;">退出</button>
      </div>
    </div>
```

**Step 3: 在 script 区域添加用户信息渲染逻辑**

在现有 script 标签内添加：

```javascript
function renderUserInfo() {
  const user = window.__currentUser;
  if (user) {
    document.getElementById('user-name').textContent = user.name;
    const avatar = document.getElementById('user-avatar');
    if (user.avatar) {
      avatar.src = user.avatar;
      avatar.style.display = 'block';
    }
    document.getElementById('logout-btn').style.display = 'block';
  }
}

document.getElementById('logout-btn').addEventListener('click', async function() {
  if (confirm('确定退出登录？')) {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  }
});

setTimeout(renderUserInfo, 100);
```

---

### Task 9: 保护敏感 API

**Files:**
- Modify: `server.js`

**Step 1: 为缓存清理添加权限保护**

找到 `app.post('/api/cache/clear'` 路由，修改为：

```javascript
app.post('/api/cache/clear', requireAdmin, (req, res) => {
  db.exec('DELETE FROM parse_cache');
  res.json({ ok: true });
});
```

**Step 2: 为解析 API 添加登录要求（可选）**

如果需要限制未登录用户使用解析功能，可以在 `/api/parse` 和 `/api/standardize` 路由添加 `requireAuth` 中间件：

```javascript
app.post('/api/standardize', requireAuth, async (req, res) => {
  // ... 现有代码
});

app.post('/api/parse', requireAuth, async (req, res) => {
  // ... 现有代码
});
```

---

### Task 10: 测试和验证

**Files:**
- 无文件修改

**Step 1: 启动服务器**

```bash
node server.js
```

**Step 2: 访问登录页**

浏览器打开 `http://localhost:3001/login.html`

Expected: 显示钉钉登录二维码

**Step 3: 测试登录状态 API**

```bash
curl http://localhost:3001/api/auth/me
```

Expected: `{"loggedIn":false,"user":null}`

**Step 4: 测试扫码登录流程**

1. 用钉钉扫描登录页二维码
2. 确认授权
3. 检查是否跳转回首页并显示用户信息

**Step 5: 测试退出登录**

1. 点击页面右上角「退出」按钮
2. 确认跳转到登录页
3. 访问首页应重定向到登录页

---

### Task 11: 提交代码

**Files:**
- 所有修改的文件

**Step 1: 检查变更**

```bash
git status
```

**Step 2: 添加所有文件**

```bash
git add .
```

**Step 3: 提交**

```bash
git commit -m "feat: 添加钉钉登录功能

- 支持扫码登录和钉钉内免登两种方式
- 使用 express-session 管理会话
- 添加用户表和登录日志表
- 简单权限控制（管理员/普通用户）
- 保护敏感 API（缓存清理需管理员权限）"
```

---

## 后续配置

### 钉钉开放平台配置

1. 登录 https://open.dingtalk.com/
2. 进入应用 → 登录与分享
3. 配置回调域名：
   - 线上：`https://www.houpe.top`
   - 本地：`http://localhost:3001`
4. 添加服务器 IP 到白名单

### 设置管理员

```sql
-- 查看所有用户
SELECT id, ding_user_id, name, is_admin FROM users;

-- 设置管理员
UPDATE users SET is_admin = 1 WHERE ding_user_id = '你的钉钉用户ID';
```