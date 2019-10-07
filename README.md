# GrabPay integration

## Develop

Create `.env` file with the following template:

```
export GRAB_PAY_BASE_URL=https://partner-api.stg-myteksi.com
export GRAB_PAY_PARTNER_ID={{partner_id}}
export GRAB_PAY_PARTNER_SECRET={{partner_secret}}
export GRAB_PAY_CLIENT_ID={{client_id}}
export GRAB_PAY_CLIENT_SECRET={{client_secret}}
export GRAB_PAY_MERCHANT_ID={{merchant_id}}
export REDIRECT_BASE_URL=http://localhost:3000
```

Run
```
npm i
source .env && node index.js
```

In the browser, open http://localhost:3000/index.html