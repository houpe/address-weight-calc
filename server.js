require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'cache.db'));
db.exec(`CREATE TABLE IF NOT EXISTS parse_cache (
  address TEXT PRIMARY KEY,
  std_data TEXT,
  parse_data TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);
db.pragma('journal_mode = WAL');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/cache/get', (req, res) => {
  const { address } = req.query;
  if (!address) return res.json({ found: false });
  const row = db.prepare('SELECT std_data, parse_data FROM parse_cache WHERE address = ?').get(address);
  if (row) {
    res.json({ found: true, std: JSON.parse(row.std_data), parse: JSON.parse(row.parse_data) });
  } else {
    res.json({ found: false });
  }
});

app.post('/api/cache/set', (req, res) => {
  const { address, std, parse } = req.body;
  if (!address || !std || !parse) return res.status(400).json({ error: '参数不完整' });
  const stmt = db.prepare('INSERT OR REPLACE INTO parse_cache (address, std_data, parse_data) VALUES (?, ?, ?)');
  stmt.run(address, JSON.stringify(std), JSON.stringify(parse));
  res.json({ ok: true });
});

app.post('/api/cache/clear', (req, res) => {
  db.exec('DELETE FROM parse_cache');
  res.json({ ok: true });
});

app.get('/api/cache/stats', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM parse_cache').get();
  const size = db.prepare("SELECT (page_count - freelist_count) * page_size as bytes FROM pragma_page_count(), pragma_freelist_count(), pragma_page_size()").get();
  res.json({ count: count.cnt, size: Math.round(size.bytes / 1024) + 'KB' });
});

app.post('/api/cache/clear', (req, res) => {
  db.exec('DELETE FROM parse_cache');
  res.json({ ok: true });
});

const ZT_API_BASE = 'https://zmap-openapi.gw.zt-express.com';
const AMAP_KEYS = (process.env.AMAP_KEYS || '2196ccf544e7a8c8f82cff1e40be3992,113c46ebcb860653b696ca01ec5ad151').split(',');
const BAIDU_AK = process.env.BAIDU_AK || 'HIM3QorvOGqquDRvLSZ1npMH9lplzcLK';
const BAIDU_ANALYZER_AK = process.env.BAIDU_AK || 'HIM3QorvOGqquDRvLSZ1npMH9lplzcLK';

// 集团解析配置 (从 .env 读取)
const GROUP_API = {
  url: process.env.GROUP_API_URL || 'https://japi.zto.com/zto.routetime.address.parsePoi',
  appKey: process.env.GROUP_APP_KEY || '2bb1ff34451005e98445a',
  appSecret: process.env.GROUP_APP_SECRET || '4f7d126c314b78ab0cf354665e3878e4'
};

function normalizeAddressText(address) {
  let text = address.trim();
  text = text.replace(/\d{7,11}/g, '');
  text = text.replace(/[#＃]/g, '');
  text = text.replace(/\s+/g, '');
  return text;
}

function bd09togcj02(bdLon, bdLat) {
  const x_pi = 3.14159265358979324 * 3000.0 / 180.0;
  const x = bdLon - 0.0065;
  const y = bdLat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

function md5Base64(str) {
  const hash = crypto.createHash('md5').update(str).digest();
  return Buffer.from(hash).toString('base64');
}

async function callGroupParse(address) {
  const params = { address, sceneCode: 'COLD_CHAIN', queryDetail: true };
  const body = JSON.stringify(params, (_, v) => typeof v === 'string' ? v.replace(/\s+/g, '') : v);
  const dataDigest = md5Base64(body + GROUP_API.appSecret);
  
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'x-appKey': GROUP_API.appKey,
    'x-dataDigest': dataDigest
  };
  
  const resp = await axios.post(GROUP_API.url, body, { headers, timeout: 10000 });
  return resp.data;
}

async function amapGeocode(address) {
  for (const key of AMAP_KEYS) {
    try {
      const resp = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
        params: { key, address }, timeout: 10000
      });
      const data = resp.data;
      if (data.status === '1' && data.geocodes && data.geocodes.length > 0) return data;
      if (data.info === 'USER_DAILY_QUERY_OVER_LIMIT') continue;
      return data;
    } catch (e) {
      if (AMAP_KEYS.indexOf(key) === AMAP_KEYS.length - 1) throw e;
    }
  }
  return { status: '0', info: 'ALL_KEYS_EXHAUSTED' };
}

app.post('/api/standardize', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: '地址不能为空' });

  const cleanAddr = normalizeAddressText(address);
  try {
    const resp = await axios.get(`${ZT_API_BASE}/address/standard`, {
      params: { key: 'ztocc', address: cleanAddr, source: '1' },
      timeout: 10000
    });
    const result = resp.data;
    let formatted = '';
    let segParts = {};
    if (result.code === 200 && result.data) {
      const d = result.data;
      segParts = {
        provName: d.provinceName || d.provName || '',
        cityName: d.cityName || '',
        countyName: d.countyName || '',
        townName: d.townName || '',
        detailAddress: d.masterAdr || d.detailAddress || ''
      };
      const parts = [];
      for (const key of ['provinceName', 'cityName', 'countyName', 'townName', 'masterAdr', 'detailAddress']) {
        if (d[key]) parts.push(d[key]);
      }
      formatted = parts.join('') || cleanAddr;
    }
    res.json({ formatted: formatted || cleanAddr, segments: segParts, raw: result });
  } catch (e) {
    res.json({ formatted: cleanAddr, segments: {}, error: e.message });
  }
});

app.get('/api/parse51', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: '地址不能为空' });
  try {
    const resp = await axios.get('https://zmap-openapi.gw.zt-express.com/address/parse51', {
      params: { address },
      timeout: 10000
    });
    res.json(resp.data);
  } catch (e) {
    res.json({ code: 500, msg: e.message, data: null });
  }
});

app.post('/api/parse', async (req, res) => {
  const { formatted, city } = req.body;
  if (!formatted) return res.status(400).json({ error: '格式化地址不能为空' });

  const results = {};

  // 1. 中通 PRO
  try {
    const params = { address: formatted };
    if (city) params.city = city;
    const resp = await axios.get(`${ZT_API_BASE}/clod/address/search`, { params, timeout: 10000 });
    const data = resp.data;
    if (data.code === 200 && data.data) {
      let lat = 0, lng = 0;
      if (data.data.latitude && data.data.longitude) {
        lat = parseFloat(data.data.latitude);
        lng = parseFloat(data.data.longitude);
      } else if (data.data.geom) {
        const parts = data.data.geom.split(',');
        if (parts.length === 2) { lng = parseFloat(parts[0]); lat = parseFloat(parts[1]); }
      }
      if (lat !== 0 && lng !== 0) {
        results.zt_pro = {
          lat, lng,
          raw: {
            name: data.data.name || '',
            province: data.data.province || data.data.provName || '',
            city: data.data.city || data.data.cityName || '',
            county: data.data.county || data.data.countyName || '',
            town: data.data.town || data.data.townName || '',
            level: data.data.level || ''
          }
        };
      }
    }
  } catch (e) { results.zt_pro = { error: e.message }; }

  // 2. 高德 POI
  try {
    const poiResp = await axios.get('https://restapi.amap.com/v3/place/text', {
      params: { key: AMAP_KEYS[0], keywords: formatted, output: 'json' }, timeout: 10000
    });
    const poiData = poiResp.data;
    if (poiData.status === '1' && poiData.pois && poiData.pois.length > 0) {
      const poi = poiData.pois[0];
      const loc = poi.location.split(',');
      if (loc.length === 2) {
        results.amap_poi = {
          lat: parseFloat(loc[1]), lng: parseFloat(loc[0]),
          raw: {
            name: poi.name || '',
            address: poi.address || '',
            adname: poi.adname || '',
            pname: poi.pname || '',
            cityname: poi.cityname || '',
            typecode: poi.typecode || ''
          }
        };
      }
    }
  } catch (e) { results.amap_poi = { error: e.message }; }

  // 3. 高德 GEO
  try {
    const data = await amapGeocode(formatted);
    if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
      const gc = data.geocodes[0];
      const loc = gc.location.split(',');
      if (loc.length === 2) {
        results.amap_geo = {
          lat: parseFloat(loc[1]), lng: parseFloat(loc[0]),
          raw: {
            province: gc.province || '',
            city: gc.city || '',
            district: gc.district || '',
            street: gc.street || '',
            number: gc.number || '',
            level: gc.level || ''
          }
        };
      }
    }
  } catch (e) { results.amap_geo = { error: e.message }; }

  // 百度 GEO (返回GCJ02坐标)
  try {
    const resp = await axios.get('https://api.map.baidu.com/geocoding/v3/', {
      params: { address: formatted, ak: BAIDU_AK, ret_coordtype: 'gcj02ll', output: 'json', extension_poi_infos: 'true' }, timeout: 10000
    });
    const data = resp.data;
    if (data.status === 0 && data.result && data.result.location) {
      const r = data.result;
      const poiInfo = (data.poi_infos && data.poi_infos.length > 0) ? data.poi_infos[0] : {};
      results.baidu_geo = {
        lat: parseFloat(r.location.lat || 0), lng: parseFloat(r.location.lng || 0),
        raw: {
          comprehension: r.comprehension || poiInfo.comprehension || '',
          confidence: r.confidence || poiInfo.confidence || '',
          level: r.level || poiInfo.level || '',
          province: poiInfo.province || '',
          city: poiInfo.city || '',
          district: poiInfo.district || '',
          town: poiInfo.town || '',
          street: poiInfo.street || '',
          formatted_address: poiInfo.formatted_address || ''
        }
      };
    }
  } catch (e) { results.baidu_geo = { error: e.message }; }

  // 百度 POI
  try {
    const resp = await axios.get('https://api.map.baidu.com/place/v2/search', {
      params: { ak: BAIDU_AK, query: formatted, region: '全国', output: 'json' }, timeout: 10000
    });
    const data = resp.data;
    if (data.status === 0 && data.results && data.results.length > 0) {
      const r = data.results[0];
      const [gcjLng, gcjLat] = bd09togcj02(r.location.lng, r.location.lat);
      results.baidu_poi = {
        lat: gcjLat, lng: gcjLng,
        raw: {
          name: r.name || '',
          address: r.address || '',
          province: r.province || '',
          city: r.city || '',
          area: r.area || '',
          street_id: r.street_id || '',
          uid: r.uid || '',
          detail: r.detail || 0
        }
      };
    }
  } catch (e) { results.baidu_poi = { error: e.message }; }

  // 百度聚合解析
  try {
    const resp = await axios.get('https://api.map.baidu.com/address_analyzer/v2', {
      params: { ak: BAIDU_ANALYZER_AK, address: formatted }, timeout: 10000
    });
    const data = resp.data;
    if (data.status === 0 && data.result && data.result.location) {
      const r = data.result;
      results.baidu_agg = {
        lat: parseFloat(r.location.lat || 0), lng: parseFloat(r.location.lng || 0),
        raw: {
          province: r.province || '',
          city: r.city || '',
          district: r.district || '',
          town: r.town || '',
          street: r.street || '',
          street_number: r.street_number || '',
          adcode: r.adcode || '',
          formatted_address: r.formatted_address || '',
          business: r.business || '',
          confidence: r.confidence || ''
        }
      };
    }
  } catch (e) { results.baidu_agg = { error: e.message }; }

  // 6. 集团解析 (BD09 -> GCJ02)
  try {
    const data = await callGroupParse(formatted);
    if (data.statusCode === '00' && data.result) {
      const r = data.result;
      const bdLat = parseFloat(r.lat || 0);
      const bdLng = parseFloat(r.lng || 0);
      if (bdLat !== 0 && bdLng !== 0) {
        const [gcjLng, gcjLat] = bd09togcj02(bdLng, bdLat);
        results.group_parse = {
          lat: gcjLat,
          lng: gcjLng,
          raw: {
            address: r.address || '',
            poiName: r.poiName || '',
            structProvince: r.structProvince || '',
            structCity: r.structCity || '',
            structDistrict: r.structDistrict || '',
            structTown: r.structTown || '',
            structRoad: r.structRoad?.parsedInfo || '',
            structRoadNo: r.structRoadNo?.originInfo || '',
            aoiName: r.aoiName || '',
            aoiTag: r.aoiTag || '',
            poiTag: r.poiTag || '',
            poiCode: r.poiCode || '',
            source: r.source || '',
            hasRectified: r.hasRectified || false,
            bd09_lat: bdLat,
            bd09_lng: bdLng
          }
        };
      }
    }
  } catch (e) { results.group_parse = { error: e.message }; }

  res.json({ formatted, parsers: results });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
