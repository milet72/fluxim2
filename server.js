const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        resolve(data);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function createPrediction(body) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable.');
  }

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${REPLICATE_API_TOKEN}`
    },
    body: JSON.stringify({
      model: body.model,
      prompt: body.prompt,
      aspect_ratio: body.aspect_ratio,
      seed: body.seed,
      output_format: body.output_format,
      disable_safety_checker: Boolean(body.disable_safety_checker),
      safety_tolerance: body.safety_tolerance,
      password: body.password
    })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody?.detail || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.detail = errorBody;
    throw error;
  }

  const data = await response.json();
  return data;
}

async function getPrediction(id) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable.');
  }

  const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody?.detail || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.detail = errorBody;
    throw error;
  }

  const data = await response.json();
  return data;
}

function serveStatic(req, res, url) {
  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/predictions') {
    try {
      const body = await parseBody(req);
      const prediction = await createPrediction(body);
      sendJson(res, 201, prediction);
    } catch (err) {
      const status = err.status || 500;
      sendJson(res, status, { detail: err.message, ...(err.detail ? { extra: err.detail } : {}) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/predictions/')) {
    const id = url.pathname.replace('/api/predictions/', '');
    try {
      const prediction = await getPrediction(id);
      sendJson(res, 200, prediction);
    } catch (err) {
      const status = err.status || 500;
      sendJson(res, status, { detail: err.message, ...(err.detail ? { extra: err.detail } : {}) });
    }
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
