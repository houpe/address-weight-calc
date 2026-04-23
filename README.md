# 地址坐标可靠度计算器

多源地址解析 · 加权质心 · 综合置信度评估

## 功能特性

- **地址解析模式**：输入地址，自动调用 6 个数据源解析并融合计算
  - 中通 PRO、高德 POI/GEO、百度 POI/GEO、百度聚合、集团解析
- **坐标计算模式**：手动输入多源坐标，加权质心算法
- **高德地图可视化**：坐标分布、质心标记、手动标记、测距工具
- **SQLite 持久缓存**：相同地址不重复请求，节省 API Key 额度
- **历史地址记录**：自动保存最近 20 条，点击即可复用

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML + CSS + Vanilla JS |
| 后端 | Node.js + Express |
| 数据库 | better-sqlite3 |
| 地图 | 高德地图 JS API v2.0 |

## 快速开始

### 本地开发

```bash
npm install
node server.js
```

访问 http://localhost:3001

### 服务器部署

```bash
# 通过 SSH 连接服务器
ssh root@www.houpe.top

# 进入项目目录
cd /path/to/project

# 启动服务
node server.js
```

## API 配置

创建 `.env` 文件：

```
AMAP_KEYS=高德Key1,高德Key2
BAIDU_AK=百度AK
GROUP_API_URL=https://japi.zto.com/zto.routetime.address.parsePoi
GROUP_APP_KEY=集团AppKey
GROUP_APP_SECRET=集团AppSecret
```

## 项目结构

```
.
├── index.html      # 前端页面
├── server.js       # Node.js 后端
├── api/            # Vercel Serverless 函数
│   ├── parse.js    # 多源解析
│   └── standardize.js  # 地址标准化
├── cache.db        # SQLite 缓存
└── .env            # API 密钥配置
```

## 测试集团生产接口

本地测试会报 SSL 错误（Node.js 新版 OpenSSL 限制），请在服务器上测试：

```bash
ssh root@www.houpe.top

cd /path/to/project
node -e "
const axios = require('axios');
const crypto = require('crypto');
const GROUP_API = {
  url: 'https://japi.zto.com/zto.routetime.address.parsePoi',
  appKey: '你的appKey',
  appSecret: '你的appSecret'
};
function md5Base64(str) {
  return crypto.createHash('md5').update(str).digest().toString('base64');
}
const address = '广东省深圳市宝安区鹤州路38号';
const body = JSON.stringify({ address, sceneCode: 'COLD_CHAIN', queryDetail: true });
const dataDigest = md5Base64(body + GROUP_API.appSecret);
axios.post(GROUP_API.url, body, {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'x-appKey': GROUP_API.appKey,
    'x-dataDigest': dataDigest
  }
}).then(r => console.log(JSON.stringify(r.data, null, 2).slice(0, 500)));
"
```
