# 钉钉登录功能设计

## 背景

为地址坐标可靠度计算器添加钉钉登录功能，实现企业内部员工身份认证。

## 需求

- **登录场景**：企业内部员工使用
- **登录方式**：同时支持扫码登录和钉钉内免登
- **权限控制**：简单区分管理员和普通用户

## 技术方案

使用 **Session + SQLite** 方案：
- `express-session` 管理会话
- SQLite 存储用户数据
- 与现有架构一致，实现简单

## 钉钉应用配置

需要在钉钉开放平台创建 H5 微应用：

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用 → H5 微应用
3. 获取 `AppKey` 和 `AppSecret`
4. 配置回调域名：
   - 线上：`www.houpe.top`
   - 本地：`localhost:3001`
5. 配置服务器 IP 白名单

## 数据库设计

### 用户表

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ding_user_id TEXT UNIQUE NOT NULL,  -- 钉钉用户ID
  name TEXT,                          -- 姓名
  avatar TEXT,                        -- 头像URL
  unionid TEXT,                       -- 钉钉 unionid
  is_admin INTEGER DEFAULT 0,          -- 是否管理员 0/1
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
```

### 登录日志表（可选）

```sql
CREATE TABLE login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  login_type TEXT,   -- 'qr' 扫码 / 'auto' 免登
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
```

## API 设计

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/api/auth/dingtalk/url` | GET | 获取扫码登录二维码URL | 公开 |
| `/api/auth/dingtalk/callback` | GET | 扫码登录回调 | 公开 |
| `/api/auth/dingtalk/auto` | POST | 钉钉内免登 | 公开 |
| `/api/auth/me` | GET | 获取当前用户信息 | 登录 |
| `/api/auth/logout` | POST | 退出登录 | 登录 |

### 接口详情

#### 1. 获取扫码登录URL

```
GET /api/auth/dingtalk/url?redirect=/path
```

返回：
```json
{
  "url": "https://oapi.dingtalk.com/connect/qrconnect?...",
  "state": "xxx"
}
```

#### 2. 扫码登录回调

```
GET /api/auth/dingtalk/callback?code=xxx&state=xxx
```

流程：
1. 验证 state
2. 用 code 换 access_token
3. 获取用户信息
4. 创建/更新用户记录
5. 设置 session
6. 重定向到 redirect 地址

#### 3. 钉钉内免登

```
POST /api/auth/dingtalk/auto
Content-Type: application/json

{
  "authCode": "xxx"
}
```

流程：
1. 前端调用 `dd.runtime.permission.requestAuthCode` 获取 authCode
2. 后端用 authCode 换用户信息
3. 创建/更新用户记录
4. 设置 session

#### 4. 获取当前用户

```
GET /api/auth/me
```

返回：
```json
{
  "loggedIn": true,
  "user": {
    "id": 1,
    "name": "张三",
    "avatar": "...",
    "isAdmin": false
  }
}
```

#### 5. 退出登录

```
POST /api/auth/logout
```

## 前端改造

### 1. 登录页面

- 显示钉钉扫码登录二维码（使用钉钉 JS 库或 iframe）
- 钉钉环境内自动调用免登流程
- 非钉钉环境显示扫码登录

### 2. 导航栏

- 显示当前用户头像和姓名
- 退出登录按钮
- 管理员显示管理入口

### 3. 路由守卫

- 访问受保护页面时检查登录状态
- 未登录跳转登录页并记录原目标地址

### 4. 权限控制

```javascript
// 检查登录状态
async function checkAuth() {
  const res = await fetch('/api/auth/me');
  return res.json();
}

// 需要登录的页面
async function requireAuth() {
  const { loggedIn } = await checkAuth();
  if (!loggedIn) {
    location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
  }
}

// 需要管理员权限
async function requireAdmin() {
  const { loggedIn, user } = await checkAuth();
  if (!loggedIn) {
    location.href = '/login.html';
    return false;
  }
  if (!user.isAdmin) {
    alert('无权限');
    return false;
  }
  return true;
}
```

## 后端中间件

### 需要登录

```javascript
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}
```

### 需要管理员

```javascript
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

## 钉钉 API 调用

### 获取 access_token

```javascript
async function getAccessToken() {
  const res = await axios.get('https://oapi.dingtalk.com/gettoken', {
    params: { appkey, appsecret }
  });
  return res.data.access_token;
}
```

### 扫码登录获取用户信息

```javascript
// 1. 用 code 换 access_token
const tokenRes = await axios.get('https://oapi.dingtalk.com/sns/gettoken', {
  params: { appid, appsecret }
});

// 2. 获取用户持久化ID
const persistentRes = await axios.post(
  'https://oapi.dingtalk.com/sns/get_persistent_code',
  { tmp_auth_code: code },
  { params: { access_token } }
);

// 3. 获取用户信息
const userInfo = await axios.post(
  'https://oapi.dingtalk.com/sns/getuserinfo',
  { persistent_code, openid },
  { params: { access_token } }
);
```

### 免登获取用户信息

```javascript
// 1. 用 authCode 换用户ID
const res = await axios.get('https://oapi.dingtalk.com/topapi/user/count', {
  params: { access_token, code: authCode }
});

// 2. 获取用户详情
const userRes = await axios.post(
  'https://oapi.dingtalk.com/topapi/v2/user/get',
  { userid },
  { params: { access_token } }
);
```

## 环境变量

在 `.env` 中添加：

```
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
DINGTALK_AGENT_ID=your_agent_id
SESSION_SECRET=随机字符串
```

## 管理员设置

首次部署后，可通过以下方式设置管理员：

```sql
UPDATE users SET is_admin = 1 WHERE ding_user_id = '钉钉用户ID';
```

或添加管理后台接口（需谨慎）。

## 安全考虑

1. Session Secret：使用强随机字符串
2. State 参数：防止 CSRF 攻击
3. HTTPS：生产环境必须使用 HTTPS
4. Token 过期：access_token 有效期 2 小时，需缓存
5. IP 白名单：在钉钉开放平台配置服务器 IP

## 文件变更清单

### 新增文件

- `auth.js` - 认证路由和中间件
- `login.html` - 登录页面

### 修改文件

- `server.js` - 添加 session 和认证路由
- `index.html` - 添加用户信息显示和权限控制
- `.env.example` - 添加钉钉配置示例

## 实现步骤

1. 后端：数据库表 + session 配置
2. 后端：钉钉 API 工具函数
3. 后端：认证路由（5个端点）
4. 后端：权限中间件
5. 前端：登录页面
6. 前端：用户信息显示
7. 前端：路由守卫
8. 测试：扫码登录流程
9. 测试：免登流程
10. 部署：配置钉钉应用回调

## 依赖安装

```bash
npm install express-session
```