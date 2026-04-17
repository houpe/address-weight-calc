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
    const resp = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
      params: { key: AMAP_KEY, address: formatted }, timeout: 10000
    });
    const data = resp.data;
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
          comprehension: r.comprehension || r.result?.comprehension || '',
          confidence: r.confidence || r.result?.confidence || '',
          level: r.level || r.result?.level || '',
          province: r.province || r.result?.province || '',
          city: r.city || r.result?.city || '',
          district: r.district || r.result?.district || '',
          town: r.town || r.result?.town || '',
          street: r.street || r.result?.street || '',
          formatted_address: r.formatted_address || r.result?.formatted_address || ''
        }
      };
    }
  } catch (e) { results.baidu_geo = { error: e.message }; }

  res.status(200).json({ formatted, parsers: results });
};
