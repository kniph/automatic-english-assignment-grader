const crypto = require('crypto');

const ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || '').trim();
const ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || '').trim();
const SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
const GRADER_BUCKET = String(process.env.R2_GRADER_BUCKET || 'kniph-grader').trim();
const ENDPOINT = ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '';

function isConfigured() {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && GRADER_BUCKET);
}

function hashHex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function toAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function encodeKey(key) {
  return String(key || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function getSigningKey(dateStamp) {
  const kDate = hmac(`AWS4${SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

async function signedRequest(method, key, options = {}) {
  if (!isConfigured()) {
    throw new Error('R2 storage is not configured');
  }

  const body = options.body || Buffer.alloc(0);
  const payloadHash = hashHex(body);
  const { amzDate, dateStamp } = toAmzDate();
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const pathname = `/${GRADER_BUCKET}/${encodeKey(key)}`;
  const url = `${ENDPOINT}${pathname}`;
  const contentType = options.contentType || 'application/octet-stream';
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };

  if (method === 'PUT') {
    headers['content-type'] = contentType;
  }

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(name => `${name}:${headers[name]}\n`)
    .join('');
  const canonicalRequest = [
    method,
    pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashHex(canonicalRequest)
  ].join('\n');
  const signature = hmac(getSigningKey(dateStamp), stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: authorization
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : body
  });

  if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
    const text = await response.text().catch(() => '');
    throw new Error(`R2 ${method} ${key} failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return response;
}

async function putBase64(key, base64, contentType = 'image/jpeg') {
  const body = Buffer.from(String(base64 || ''), 'base64');
  await signedRequest('PUT', key, { body, contentType });
  return key;
}

async function putBuffer(key, buffer, contentType = 'application/octet-stream') {
  await signedRequest('PUT', key, { body: Buffer.from(buffer), contentType });
  return key;
}

async function getBase64(key) {
  const response = await signedRequest('GET', key);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

async function deleteObject(key) {
  if (!key || !isConfigured()) return;
  await signedRequest('DELETE', key).catch(error => {
    console.warn(`Failed to delete R2 object ${key}:`, error.message || error);
  });
}

async function deleteObjects(keys) {
  const uniqueKeys = [...new Set((keys || []).filter(Boolean))];
  await Promise.all(uniqueKeys.map(deleteObject));
}

module.exports = {
  isConfigured,
  putBase64,
  putBuffer,
  getBase64,
  deleteObject,
  deleteObjects
};
