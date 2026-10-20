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

const Badge = require('./models/Badge');
const Challenge = require('./models/Challenge');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/', (req, res) => {
  res.render('index');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});