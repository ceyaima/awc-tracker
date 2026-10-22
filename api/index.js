require('dotenv').config();
const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const Badge = require('../models/Badge');
const Challenge = require('../models/Challenge');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.set('view engine', 'pug');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));

// -------------------------------------------------------------
// Serverless-Aware Cached MongoDB Connection
// -------------------------------------------------------------
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('No MONGODB_URI or MONGO_URI specified in environment variables.');
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
      bufferCommands: false, // Prevents queries from hanging indefinitely
    }).then((m) => {
      console.log(`✓ Connected to MongoDB! (Database: "${m.connection.name}")`);
      return m;
    }).catch((err) => {
      cached.promise = null; // Reset promise on failure so subsequent requests can retry
      throw err;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// Middleware: Ensures MongoDB connection is ready before handling DB routes
const ensureDbConnected = async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.error('✗ MongoDB Connection Error:', err.message);
    return res.status(503).json({ error: `MongoDB connection error: ${err.message}` });
  }
};

// -------------------------------------------------------------
// Database Routes (Wrapped with ensureDbConnected)
// -------------------------------------------------------------

// 1. Unified init endpoint
app.get('/api/init-data', ensureDbConnected, async (req, res) => {
  try {
    const [challenges, badges] = await Promise.all([
      Challenge.find({}).lean(),
      Badge.find({}).lean()
    ]);
    return res.json({ challenges, badges, source: 'mongodb' });
  } catch (err) {
    console.error('MongoDB /api/init-data query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 2. Separate endpoints
app.get('/api/challenges', ensureDbConnected, async (req, res) => {
  try {
    const challenges = await Challenge.find({}).lean();
    return res.json(challenges);
  } catch (e) {
    console.error('MongoDB /api/challenges query failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/badges', ensureDbConnected, async (req, res) => {
  try {
    const badges = await Badge.find({}).lean();
    return res.json(badges);
  } catch (e) {
    console.error('MongoDB /api/badges query failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Diagnostic health check
app.get('/api/health', async (req, res) => {
  try {
    await connectToDatabase();
    res.json({
      status: 'healthy',
      mongoReadyState: mongoose.connection.readyState,
      dbName: mongoose.connection.name || null,
      challengesCount: await Challenge.countDocuments(),
      badgesCount: await Badge.countDocuments()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      mongoReadyState: mongoose.connection.readyState,
      error: err.message
    });
  }
});

// -------------------------------------------------------------
// External Proxy Routes (No DB required)
// -------------------------------------------------------------
app.get('/api/awc-profile/:username', async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    const cardUrl = `https://awc.moe/challenger/${encodeURIComponent(username)}/card`;
    const resp = await fetch(cardUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `AWC returned status ${resp.status}` });
    }
    const svgText = await resp.text();
    const placeMatch = svgText.match(/class=["'][^"']*placement[^"']*["'][^>]*>\s*(#\d+)\s*<\/text>/i)
      || svgText.match(/>\s*(#\d{1,5})\s*<\/text>/i);
    const labelMatch = svgText.match(/class=["'][^"']*label[^"']*["'][^>]*>\s*(\d+)\s*p\s*-\s*([A-Za-z0-9\s]+?)\s*<\/text>/i);

    const place = placeMatch ? placeMatch[1] : null;
    const points = labelMatch ? `${labelMatch[1]} points` : null;
    const rank = labelMatch ? labelMatch[2].trim() : null;

    return res.json({ place, points, rank });
  } catch (err) {
    console.warn(`Error fetching AWC profile for ${username}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/awc-challenger/:username', async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    const pageUrl = `https://awc.moe/challenger/${encodeURIComponent(username)}`;
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `AWC returned status ${resp.status}` });
    }
    const htmlText = await resp.text();
    return res.type('text/html').send(htmlText);
  } catch (err) {
    console.warn(`Error fetching AWC challenger page for ${username}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.render('index');
});

// Database offline / Mongoose error handling fallback
app.use((err, req, res, next) => {
  if (err.name === 'MongooseError' || err.name === 'MongoNetworkError' || (err.message && err.message.includes('buffering timed out'))) {
    console.warn('[Database] Offline — returning empty response');
    if (req.method === 'GET') {
      return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
    }
    return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
  }
  next(err);
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;