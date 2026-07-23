const mongoose = require('mongoose');

const studentRecordSchema = new mongoose.Schema({
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentSource', index: true },
  sheetTitle: { type: String, trim: true, default: 'Students' },
  className: { type: String, trim: true, default: 'Unassigned', index: true },
  rollNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  dob: { type: String, required: true, trim: true },
  department: { type: String, trim: true, default: '' },
  year: { type: String, trim: true, default: '' },
  section: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  sheetOrder: { type: Number, default: 0, index: true },
  sourceRow: { type: Number, default: 0, index: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('StudentRecord', studentRecordSchema);
