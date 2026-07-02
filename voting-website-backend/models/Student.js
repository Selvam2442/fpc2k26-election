const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  rollNumber: { type: String, required: true, unique: true },
  name: { type: String },
  hasVoted: { type: Boolean, default: true }
});

module.exports = mongoose.model('Student', studentSchema);