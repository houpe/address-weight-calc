const axios = require('axios');

const DINGTALK_APP_KEY = process.env.DINGTALK_APP_KEY;
const DINGTALK_APP_SECRET = process.env.DINGTALK_APP_SECRET;

let cachedToken = null;
let tokenExpireTime = 0;

function normalizeDingTalkError(error) {
  const dingTalkResponse = error?.response?.data;
  const errorCode = error?.response?.data?.code;
  const normalizedError = new Error(error?.response?.data?.message || error.message);
  normalizedError.dingTalkStatus = error?.response?.status;
  normalizedError.dingTalkResponse = dingTalkResponse;

  if (errorCode === 'Forbidden.AccessDenied.AccessTokenPermissionDenied') {
    normalizedError.message = '钉钉后台缺少网页登录所需权限，请检查 Contact.User.Read 和 Contact.User.mobile 是否已开通并发布生效';
    return normalizedError;
  }

  const message = error?.response?.data?.message;
  if (message) {
    normalizedError.message = message;
    return normalizedError;
  }

  return error;
}

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

function getQrConnectUrl(redirectUri, state) {
  const redirect = encodeURIComponent(redirectUri);
  return `https://login.dingtalk.com/oauth2/auth?redirect_uri=${redirect}&client_id=${DINGTALK_APP_KEY}&response_type=code&scope=openid&state=${state}&prompt=consent`;
}

async function getUserByCode(code) {
  try {
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
  } catch (error) {
    throw normalizeDingTalkError(error);
  }
}

module.exports = {
  getAccessToken,
  getUserByAuthCode,
  getQrConnectUrl,
  getUserByCode
};
