const mongoose = require('mongoose');

const pushConfigSchema = new mongoose.Schema({
  configId: { type: String, required: true, unique: true, default: 'web_push' },
  publicKey: { type: String, required: true },
  privateKey: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('PushConfig', pushConfigSchema);
