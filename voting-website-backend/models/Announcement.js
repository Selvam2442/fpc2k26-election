const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  body: { type: String, required: true, trim: true, maxlength: 3000 },
  audience: { type: String, enum: ['ALL', 'STUDENTS', 'FACULTY'], default: 'STUDENTS' },
  priority: { type: String, enum: ['NORMAL', 'IMPORTANT', 'URGENT'], default: 'NORMAL' },
  targetClasses: [{ type: String, trim: true }],
  image: { type: String, default: '' },
  imageAlt: { type: String, trim: true, maxlength: 180, default: '' },
  linkUrl: { type: String, trim: true, maxlength: 1000, default: '' },
  linkLabel: { type: String, trim: true, maxlength: 80, default: 'Open link' },
  published: { type: Boolean, default: true },
  publishAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Announcement', announcementSchema);
