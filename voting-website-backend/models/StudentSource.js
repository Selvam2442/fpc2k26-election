const mongoose = require('mongoose');

const studentSourceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  sheetId: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true },
  lastSyncAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  studentCount: { type: Number, default: 0 },
  classCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('StudentSource', studentSourceSchema);
