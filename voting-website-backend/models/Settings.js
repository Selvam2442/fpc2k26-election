const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // We only need one settings document ever, so we can give it a custom ID
  settingsId: {
    type: String,
    default: 'master_config',
    unique: true
  },
  isPublished: {
    type: Boolean,
    default: false // Admin can hide candidates until they are ready
  },
  startTime: {
    type: Date,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  cardTitle: {
    type: String,
    default: ''
  },
  cardDescription: {
    type: String,
    default: ''
  },
  isCardVisible: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);