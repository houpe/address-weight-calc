const axios = require('axios');

const ZT_API_BASE = 'https://zmap-openapi.gw.zt-express.com';

function normalizeAddressText(address) {
  let text = address.trim();
  text = text.replace(/\d{7,11}/g, '');
  text = text.replace(/[#＃]/g, '');
  text = text.replace(/\s+/g, '');
  return text;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.body || {};
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
    res.status(200).json({ formatted: formatted || cleanAddr, raw: result });
  } catch (e) {
    res.status(200).json({ formatted: cleanAddr, error: e.message });
  }
};
