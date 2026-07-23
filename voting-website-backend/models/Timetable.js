const mongoose = require('mongoose');

const periodSchema = new mongoose.Schema({
  subject: { type: String, trim: true, default: '' },
  faculty: { type: String, trim: true, default: '' }
}, { _id: false });

const daySchema = new mongoose.Schema({
  day: { type: String, required: true, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
  periods: { type: [periodSchema], default: [] }
}, { _id: false });

const timetableSchema = new mongoose.Schema({
  className: { type: String, required: true, unique: true, trim: true, index: true },
  department: { type: String, trim: true, default: '' },
  sheetTitle: { type: String, trim: true, default: '' },
  schedule: { type: [daySchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Timetable', timetableSchema);
