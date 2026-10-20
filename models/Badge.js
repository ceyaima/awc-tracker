const mongoose = require('mongoose');

const badgeSchema = new mongoose.Schema({
  badgeId: { type: String, required: true, index: true }, // e.g., "4448"
  media: { type: String, enum: ['anime', 'manga'], required: true }, // separates anime vs manga
  images: [{ type: String, required: true }] // Array of image URLs
});

// Ensure a badgeId is unique per media type
badgeSchema.index({ badgeId: 1, media: 1 }, { unique: true });

module.exports = mongoose.model('Badge', badgeSchema);