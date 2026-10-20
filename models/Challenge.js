const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, index: true }, // e.g., "4448"
  media: { type: String, enum: ['anime', 'manga'], required: true }, // separates anime vs manga
  name: { type: String, required: true },
  points: { type: Number, required: true },
  category: { type: String, required: true },
  type: { type: String, required: true } // e.g., "single"
}, { strict: false }); 

// Ensure a challengeId is unique per media type
challengeSchema.index({ challengeId: 1, media: 1 }, { unique: true });

module.exports = mongoose.models.Challenge || mongoose.model('Challenge', challengeSchema);