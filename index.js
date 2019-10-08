const express = require('express');
const fetch = require('node-fetch');
const CryptoJS = require('crypto-js');
const querystring = require('querystring');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const moment = require('moment');

const GRAB_PAY_BASE_URL = process.env.GRAB_PAY_BASE_URL;
const GRAB_PAY_PARTNER_ID = process.env.GRAB_PAY_PARTNER_ID;
const GRAB_PAY_PARTNER_SECRET = process.env.GRAB_PAY_PARTNER_SECRET;
const GRAB_PAY_CLIENT_ID = process.env.GRAB_PAY_CLIENT_ID;
const GRAB_PAY_CLIENT_SECRET = process.env.GRAB_PAY_CLIENT_SECRET;
const GRAB_PAY_MERCHANT_ID = process.env.GRAB_PAY_MERCHANT_ID;
const REDIRECT_BASE_URL=process.env.REDIRECT_BASE_URL;

const app = express();
const port = 3000;

app.use(session({
  cookie: { maxAge: 86400000 },
  store: new MemoryStore({
    checkPeriod: 86400000
  }),
  secret: 'foobar'
}));

app.use(express.static('public'));

app.post('/pay', (req, res) => {
  let paymentDate = new Date();
  let orderID = `ORD${paymentDate.getTime()}`;
  req.session.orderID = orderID;
  let payload = { 
    'partnerGroupTxID': orderID, 
    'partnerTxID': orderID, 
    'currency': 'SGD', 
    'amount': 1, 
    'description': 'test charge', 
    'merchantID': GRAB_PAY_MERCHANT_ID,
    'isSync': true
  };
  let httpMethod = 'POST';
  let contentType = 'application/json'
  let paymentDateUtc = paymentDate.toUTCString();
  let jsonPayload = JSON.stringify(payload);
  let hmacSignature = generateHMACSignature(
    httpMethod, 
    contentType, 
    '/grabpay/partner/v2/charge/init', 
    paymentDateUtc, 
    jsonPayload);
  
  fetch(`${GRAB_PAY_BASE_URL}/grabpay/partner/v2/charge/init`, {
      method: httpMethod,
      body: jsonPayload,
      headers: {
        'Content-Type': contentType,
        'Authorization': `${GRAB_PAY_PARTNER_ID}:${hmacSignature}`,
        'Date': paymentDateUtc
      }
  })
  .then(result => result.json())
  .then(json => {
    if (json.request) {
      req.session.codeVerifier = base64URLEncode(generateRandomString(64)); 
      let authorizeQueryString = getAuthorizeQueryString(json.request, req.session.codeVerifier);
      let redirectUri = `${GRAB_PAY_BASE_URL}/grabid/v1/oauth2/authorize?${authorizeQueryString}`;
      console.log(`Redirecting to ${redirectUri}`)
      res.redirect(redirectUri);
    } else {
      res.json(json);
    }
  })
  .catch(err => console.error(err));
});

app.get('/grabpay/callback', (req, res) => {
  if (req.query.error) {
    res.send(req.query);
    return;
  }

  let payload = {
    'code': req.query.code,
    'client_id': GRAB_PAY_CLIENT_ID,
    'client_secret': GRAB_PAY_CLIENT_SECRET,
    'grant_type': 'authorization_code',
    'redirect_uri': `${REDIRECT_BASE_URL}/grabpay/callback`,
    'code_verifier': req.session.codeVerifier,
    'client_secret': GRAB_PAY_CLIENT_SECRET
  }
  fetch(`${GRAB_PAY_BASE_URL}/grabid/v1/oauth2/token`, {
        method: 'POST',
        body: querystring.stringify(payload),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
    .then(result => result.json())
    .then(json => {
      console.log(json);
      let popSignature = generateHMACForPop(json.access_token);
      console.log(`POP Signature: ${popSignature}`);
      let payload = {
        'partnerTxID': req.session.orderID
      };
      return fetch(`${GRAB_PAY_BASE_URL}/grabpay/partner/v2/charge/complete`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          'X-GID-AUX-POP': popSignature,
          'Authorization': `Bearer ${json.access_token}`,
          'Date': new Date().toUTCString()
        }
      });
    })
    .then(result => result.json())
    .then(json => res.json(json))
    .catch(err => console.error(err));
});

app.listen(port, () => console.log(`server listening on port ${port}!`));

function generateHMACForPop(accessToken) {     
  let currentTimestamp = moment().unix();
  let messageToHash = `${currentTimestamp}${accessToken}`;
  let signature = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(messageToHash, GRAB_PAY_CLIENT_SECRET));
  let payload = {
    'time_since_epoch': currentTimestamp,
    'sig': signature
  };
	console.log(payload);

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function generateHMACSignature(httpMethod, contentType, requestPath, date, requestBody) {
  let hashedPayload = CryptoJS.enc.Base64.stringify(CryptoJS.SHA256(requestBody));
  let requestData = `${httpMethod}
${contentType}
${date}
${requestPath}
${hashedPayload}
`
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(requestData, GRAB_PAY_PARTNER_SECRET));
}

function getAuthorizeQueryString(request, codeVerifier) { 
  let codeChallenge = base64URLEncode(CryptoJS.SHA256(codeVerifier)); 
  let params = { 
    client_id : GRAB_PAY_CLIENT_ID, 
    scope: ['openid', 'payment.one_time_charge'].join(' '), 
    response_type: 'code', 
    redirect_uri: `${REDIRECT_BASE_URL}/grabpay/callback`, 
    nonce: generateRandomString(16), 
    state: generateRandomString(7), 
    code_challenge_method: 'S256', 
    code_challenge: codeChallenge, 
    request: request, 
    acr_values: 'consent_ctx:countryCode=SG,currency=SGD'
  }; 
  return querystring.stringify(params);
}

function generateRandomString(length) {
  let text = '';
  let possible ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function base64URLEncode(str) {
  return str.toString(CryptoJS.enc.Base64)
            .replace(/=/g,'')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
}