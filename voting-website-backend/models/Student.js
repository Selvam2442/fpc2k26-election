const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  rollNumber: { type: String, required: true, unique: true },
  name: { type: String },
  hasVoted: { type: Boolean, default: true },
  candidateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' }],
  votedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);
