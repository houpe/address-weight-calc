const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const ZT_API_BASE = 'https://zmap-openapi.gw.zt-express.com';
const AMAP_KEY = '2196ccf544e7a8c8f82cff1e40be3992';
const BAIDU_AK = 'HIM3QorvOGqquDRvLSZ1npMH9lplzcLK';

function normalizeAddressText(address) {
  let text = address.trim();
  text = text.replace(/\d{7,11}/g, '');
  text = text.replace(/[#＃]/g, '');
  text = text.replace(/\s+/g, '');
  return text;
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
    if (result.code === 200 && result.data) {
      const d = result.data;
      const parts = [];
      for (const key of ['provName', 'cityName', 'countyName', 'townName', 'detailAddress']) {
        if (d[key]) parts.push(d[key]);
      }
      formatted = parts.join('') || cleanAddr;
    }
    res.json({ formatted: formatted || cleanAddr, raw: result });
  } catch (e) {
    res.json({ formatted: cleanAddr, error: e.message });
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
        if (parts.length === 2) {
          lng = parseFloat(parts[0]);
          lat = parseFloat(parts[1]);
        }
      }
      if (lat !== 0 && lng !== 0) {
        results.zt_pro = { lat, lng, raw: data.data };
      }
    }
  } catch (e) {
    results.zt_pro = { error: e.message };
  }

  // 2. 高德 GEO
  try {
    const resp = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
      params: { key: AMAP_KEY, address: formatted },
      timeout: 10000
    });
    const data = resp.data;
    if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
      const loc = data.geocodes[0].location.split(',');
      if (loc.length === 2) {
        results.amap_geo = {
          lat: parseFloat(loc[1]),
          lng: parseFloat(loc[0]),
          raw: data.geocodes[0]
        };
      }
    }
  } catch (e) {
    results.amap_geo = { error: e.message };
  }

  // 3. 百度 GEO (返回GCJ02坐标)
  try {
    const resp = await axios.get('https://api.map.baidu.com/geocoding/v3/', {
      params: {
        address: formatted,
        ak: BAIDU_AK,
        ret_coordtype: 'gcj02ll',
        output: 'json'
      },
      timeout: 10000
    });
    const data = resp.data;
    if (data.status === 0 && data.result && data.result.location) {
      results.baidu_geo = {
        lat: parseFloat(data.result.location.lat || 0),
        lng: parseFloat(data.result.location.lng || 0),
        raw: data.result
      };
    }
  } catch (e) {
    results.baidu_geo = { error: e.message };
  }

  res.json({ formatted, parsers: results });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
