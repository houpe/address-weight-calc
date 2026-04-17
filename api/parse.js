const axios = require('axios');

const ZT_API_BASE = 'https://zmap-openapi.gw.zt-express.com';
const AMAP_KEY = '2196ccf544e7a8c8f82cff1e40be3992';
const BAIDU_AK = 'HIM3QorvOGqquDRvLSZ1npMH9lplzcLK';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { formatted, city } = req.body || {};
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
      if (lat !== 0 && lng !== 0) results.zt_pro = { lat, lng, raw: data.data };
    }
  } catch (e) { results.zt_pro = { error: e.message }; }

  // 2. 高德 GEO
  try {
    const resp = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
      params: { key: AMAP_KEY, address: formatted }, timeout: 10000
    });
    const data = resp.data;
    if (data.status === '1' && data.geocodes && data.geocodes.length > 0) {
      const loc = data.geocodes[0].location.split(',');
      if (loc.length === 2) results.amap_geo = { lat: parseFloat(loc[1]), lng: parseFloat(loc[0]), raw: data.geocodes[0] };
    }
  } catch (e) { results.amap_geo = { error: e.message }; }

  // 3. 百度 GEO (返回GCJ02坐标)
  try {
    const resp = await axios.get('https://api.map.baidu.com/geocoding/v3/', {
      params: { address: formatted, ak: BAIDU_AK, ret_coordtype: 'gcj02ll', output: 'json' }, timeout: 10000
    });
    const data = resp.data;
    if (data.status === 0 && data.result && data.result.location) {
      results.baidu_geo = { lat: parseFloat(data.result.location.lat || 0), lng: parseFloat(data.result.location.lng || 0), raw: data.result };
    }
  } catch (e) { results.baidu_geo = { error: e.message }; }

  res.status(200).json({ formatted, parsers: results });
};
