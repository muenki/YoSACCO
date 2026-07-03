const axios = require('axios');

const BASE_URL = process.env.PESAPAL_ENV === 'production'
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

// Get OAuth token
async function getToken() {
  const res = await axios.post(`${BASE_URL}/api/Auth/RequestToken`, {
    consumer_key: process.env.PESAPAL_CONSUMER_KEY,
    consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
  }, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
  return res.data.token;
}

// Register IPN URL (do once)
async function registerIPN(token) {
  const res = await axios.post(`${BASE_URL}/api/URLSetup/RegisterIPN`, {
    url: process.env.PESAPAL_IPN_URL,
    ipn_notification_type: 'POST',
  }, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
  return res.data.ipn_id;
}

// Submit payment order
async function submitOrder({ token, ipnId, amount, currency = 'UGX', description, reference, email, phone, firstName, lastName, callbackUrl }) {
  const res = await axios.post(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, {
    id: reference,
    currency,
    amount,
    description,
    callback_url: callbackUrl,
    notification_id: ipnId,
    billing_address: {
      email_address: email,
      phone_number: phone,
      first_name: firstName,
      last_name: lastName,
    },
  }, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
  return res.data;
}

// Get transaction status
async function getTransactionStatus(token, orderTrackingId) {
  const res = await axios.get(`${BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.data;
}

module.exports = { getToken, registerIPN, submitOrder, getTransactionStatus };
