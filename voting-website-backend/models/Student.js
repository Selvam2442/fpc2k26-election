const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  rollNumber: {
    type: String,
    required: true,
    unique: true, // Ensures no two students have the same roll number
    uppercase: true,
    trim: true
  },
  dob: {
    type: String, 
    required: true,
    // Storing DOB as a string (e.g., "15-08-2005") makes it much easier 
    // to match exactly with what you type in the Excel sheet!
  },
  hasVoted: {
    type: Boolean,
    default: false // Every student starts having not voted
  },
  votedFor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate', // Links directly to the Candidate they voted for
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);