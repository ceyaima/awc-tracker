require('dotenv').config();
const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const Badge = require('./models/Badge');
const Challenge = require('./models/Challenge');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to load local JSON files if MongoDB is empty or unreachable
function loadLocalJsonBackup() {
  const possiblePaths = ['./json', './challenges', './public/challenges', '../json'];
  let jsonDir = null;

  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(__dirname, p, 'anime_challenges.json'))) {
      jsonDir = path.join(__dirname, p);
      break;
    }
  }

  if (!jsonDir) return null;

  try {
    const animeChallenges = JSON.parse(fs.readFileSync(path.join(jsonDir, 'anime_challenges.json'), 'utf8'));
    const mangaChallenges = JSON.parse(fs.readFileSync(path.join(jsonDir, 'manga_challenges.json'), 'utf8'));
    const animeBadges = JSON.parse(fs.readFileSync(path.join(jsonDir, 'anime_badges.json'), 'utf8'));
    const mangaBadges = JSON.parse(fs.readFileSync(path.join(jsonDir, 'manga_badges.json'), 'utf8'));

    const challengesList = [];
    Object.entries(animeChallenges).forEach(([id, d]) => challengesList.push({ challengeId: String(id), media: 'anime', ...d }));
    Object.entries(mangaChallenges).forEach(([id, d]) => challengesList.push({ challengeId: String(id), media: 'manga', ...d }));

    const badgesList = [];
    Object.entries(animeBadges).forEach(([id, imgs]) => badgesList.push({ badgeId: String(id), media: 'anime', images: imgs }));
    Object.entries(mangaBadges).forEach(([id, imgs]) => badgesList.push({ badgeId: String(id), media: 'manga', images: imgs }));

    return { challenges: challengesList, badges: badgesList };
  } catch (err) {
    console.warn('Could not read local JSON backup:', err.message);
    return null;
  }
}

// Connect to MongoDB Atlas
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  })
    .then(async () => {
      console.log(`✓ Connected to MongoDB Atlas! (Database: "${mongoose.connection.name}")`);
      
      // Auto-seed if collections are empty
      const cCount = await Challenge.countDocuments();
      const bCount = await Badge.countDocuments();
      console.log(`[DB Status] Challenges: ${cCount}, Badges: ${bCount}`);

      if (cCount === 0 || bCount === 0) {
        console.log('Database is empty. Checking local JSON files to auto-seed...');
        const backup = loadLocalJsonBackup();
        if (backup) {
          if (cCount === 0 && backup.challenges.length > 0) {
            await Challenge.insertMany(backup.challenges);
            console.log(`✓ Auto-seeded ${backup.challenges.length} challenges into MongoDB Atlas!`);
          }
          if (bCount === 0 && backup.badges.length > 0) {
            await Badge.insertMany(backup.badges);
            console.log(`✓ Auto-seeded ${backup.badges.length} badges into MongoDB Atlas!`);
          }
        }
      }
    })
    .catch(err => {
      console.error('✗ MongoDB Connection Error:', err.message);
      console.log('⚠️ Running in JSON fallback mode until MongoDB connection is restored.');
    });
} else {
  console.warn('⚠️ No MONGO_URI specified in .env. Running in local JSON mode.');
}

// 1. Unified init endpoint
app.get('/api/init-data', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const [challenges, badges] = await Promise.all([
        Challenge.find({}).lean(),
        Badge.find({}).lean()
      ]);

      if (challenges.length > 0 || badges.length > 0) {
        return res.json({ challenges, badges, source: 'mongodb' });
      }
    }
  } catch (err) {
    console.warn('MongoDB query failed, attempting local fallback:', err.message);
  }

  // Fallback to local JSON files if DB is down or empty
  const backup = loadLocalJsonBackup();
  if (backup) {
    return res.json({ ...backup, source: 'local_json_fallback' });
  }

  res.status(500).json({ error: 'No challenge data available from MongoDB or local JSON files.' });
});

// 2. Separate endpoints
app.get('/api/challenges', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const challenges = await Challenge.find({}).lean();
      if (challenges.length > 0) return res.json(challenges);
    }
  } catch (e) {}

  const backup = loadLocalJsonBackup();
  if (backup) return res.json(backup.challenges);
  res.status(500).json({ error: 'Failed to fetch challenges' });
});

app.get('/api/badges', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const badges = await Badge.find({}).lean();
      if (badges.length > 0) return res.json(badges);
    }
  } catch (e) {}

  const backup = loadLocalJsonBackup();
  if (backup) return res.json(backup.badges);
  res.status(500).json({ error: 'Failed to fetch badges' });
});

// Diagnostic health check
app.get('/api/health', async (req, res) => {
  res.json({
    mongoReadyState: mongoose.connection.readyState,
    dbName: mongoose.connection.name,
    challengesCount: mongoose.connection.readyState === 1 ? await Challenge.countDocuments() : 0,
    badgesCount: mongoose.connection.readyState === 1 ? await Badge.countDocuments() : 0
  });
});

app.get('/', (req, res) => {
  res.render('index');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});