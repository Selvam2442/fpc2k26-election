const mongoose = require('mongoose');

const electionArchiveSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  academicYear: { type: String, trim: true, default: '' },
  published: { type: Boolean, default: false, index: true },
  eligible: {
    students: { type: Number, default: 0 },
    staff: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  participation: {
    students: { type: Number, default: 0 },
    staff: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    turnout: { type: Number, default: 0 }
  },
  candidates: [{
    candidateId: { type: mongoose.Schema.Types.ObjectId },
    name: String,
    posting: String,
    department: String,
    year: Number,
    section: String,
    votes: Number
  }],
  winners: [{
    position: String,
    name: String,
    department: String,
    votes: Number,
    isTie: { type: Boolean, default: false }
  }],
  archivedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

module.exports = mongoose.model('ElectionArchive', electionArchiveSchema);
