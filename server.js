const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const ZT_API_BASE = 'https://zmap-openapi.gw.zt-express.com';
const AMAP_KEYS = ['2196ccf544e7a8c8f82cff1e40be3992', '113c46ebcb860653b696ca01ec5ad151'];
const BAIDU_AK = 'HIM3QorvOGqquDRvLSZ1npMH9lplzcLK';

function normalizeAddressText(address) {
  let text = address.trim();
  text = text.replace(/\d{7,11}/g, '');
  text = text.replace(/[#＃]/g, '');
  text = text.replace(/\s+/g, '');
  return text;
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

  // 2. 高德 GEO
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

  // 3. 百度 GEO (返回GCJ02坐标)
  try {
    const resp = await axios.get('https://api.map.baidu.com/geocoding/v3/', {
      params: { address: formatted, ak: BAIDU_AK, ret_coordtype: 'gcj02ll', output: 'json', extension_poi_infos: 'true' }, timeout: 10000
    });
    const data = resp.data;
    if (data.status === 0 && data.result && data.result.location) {
      const r = data.result;
      results.baidu_geo = {
        lat: parseFloat(r.location.lat || 0), lng: parseFloat(r.location.lng || 0),
        raw: {
          comprehension: r.comprehension || '',
          confidence: r.confidence || '',
          level: r.level || '',
          province: r.province || '',
          city: r.city || '',
          district: r.district || '',
          town: r.town || '',
          street: r.street || '',
          formatted_address: r.formatted_address || ''
        }
      };
    }
  } catch (e) { results.baidu_geo = { error: e.message }; }

  res.json({ formatted, parsers: results });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
