// server.js - Unified server: serves frontend + proxies email verification API
// Deploy on Render: https://render.com

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const API_BASE = 'https://rapid-email-verifier.fly.dev/api/validate';
const FRONTEND_PATH = path.join(__dirname, 'public', 'index.html');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // CORS headers (for local development; Render same-origin handles production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // ===== API ENDPOINT: /verify?email=... =====
  if (req.method === 'GET' && url.pathname === '/verify') {
    const email = url.searchParams.get('email');
    
    if (!email || !email.includes('@')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid email parameter' }));
      return;
    }
    
    try {
      // Call the free verifier API server-side (no CORS issues)
      const apiRes = await fetch(`${API_BASE}?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      
      if (!apiRes.ok) {
        throw new Error(`API returned ${apiRes.status}`);
      }
      
      const data = await apiRes.json();
      
      // Forward response to browser
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      
    } catch (err) {
      console.error(`[PROXY ERROR] ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', details: err.message }));
    }
    return;
  }
  
  // ===== HEALTH CHECK (for Render uptime monitoring) =====
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  
  // ===== STATIC FILE SERVING (frontend) =====
  if (req.method === 'GET') {
    let filePath = url.pathname === '/' ? FRONTEND_PATH : path.join(__dirname, 'public', url.pathname);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // Serve index.html for SPA routing (if needed)
          if (url.pathname !== '/') {
            fs.readFile(FRONTEND_PATH, (e, c) => {
              if (e) { res.writeHead(500); res.end('Server error'); return; }
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(c, 'utf-8');
            });
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } else {
          res.writeHead(500);
          res.end(`Server error: ${err.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
    return;
  }
  
  // Fallback for unsupported methods
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
});

server.listen(PORT, () => {
  console.log(`✅ Email Finder running on port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 Proxy API: http://localhost:${PORT}/verify?email=test@example.com`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown for Render deployments
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => process.exit(0));
});
