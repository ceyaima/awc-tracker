require('dotenv').config();
const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// Fail fast on database queries if MongoDB is not connected
mongoose.set('bufferCommands', false);

const Badge = require('../models/Badge');
const Challenge = require('../models/Challenge');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.set('view engine', 'pug');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));

// Connect to MongoDB Atlas
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (mongoUri) {
  mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000
  })
    .then(async () => {
      console.log(`✓ Connected to MongoDB! (Database: "${mongoose.connection.name}")`);
      try {
        const cCount = await Challenge.countDocuments();
        const bCount = await Badge.countDocuments();
        console.log(`[DB Status] Challenges: ${cCount}, Badges: ${bCount}`);
      } catch (err) {
        console.warn('Could not query counts from MongoDB:', err.message);
      }
    })
    .catch(err => {
      console.error('✗ MongoDB Connection Error:', err.message);
    });
} else {
  console.warn('⚠️ No MONGODB_URI or MONGO_URI specified in environment.');
}

// 1. Unified init endpoint
app.get('/api/init-data', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB database is not connected' });
    }
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
app.get('/api/challenges', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB database is not connected' });
    }
    const challenges = await Challenge.find({}).lean();
    return res.json(challenges);
  } catch (e) {
    console.error('MongoDB /api/challenges query failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/badges', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB database is not connected' });
    }
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
    const isReady = mongoose.connection.readyState === 1;
    res.json({
      mongoReadyState: mongoose.connection.readyState,
      dbName: mongoose.connection.name || null,
      challengesCount: isReady ? await Challenge.countDocuments() : 0,
      badgesCount: isReady ? await Badge.countDocuments() : 0
    });
  } catch (err) {
    res.status(500).json({
      mongoReadyState: mongoose.connection.readyState,
      error: err.message
    });
  }
});

// AWC Profile Proxy - Avoids client-side CORS issues and accurately parses card SVG
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

// AWC Challenger page proxy for importing badges without CORS
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

// Database offline / Mongoose error handling middleware
app.use((err, req, res, next) => {
  if (err.name === 'MongooseError' || err.name === 'MongoNetworkError' || (err.message && err.message.includes('buffering timed out'))) {
    console.warn('[AI Studio] Database offline — returning mock empty response');
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