const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  posting: {
    type: String,
    required: true,
    trim: true // Admin can freely type options like "Chairman", "Secretary", etc.
  },
  department: {
    type: String,
    required: true,
    enum: ['BCA', 'BBA', 'BCOM'] // Restricts entry to only these three departments
  },
  year: {
    type: Number,
    required: true,
    enum: [1, 2, 3] // Restricts entry to 1st, 2nd, or 3rd year
  },
  section: {
    type: String,
    enum: ['A', 'B', 'None'],
    default: 'None' // Default to 'None' for BBA/BCOM unless BCA admin chooses A or B
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  photo: {
    type: String,
    required: true // Stores the file path string of the uploaded image
  },
  votes: {
    type: Number,
    default: 0 // Track votes directly on the candidate document
  }
}, { timestamps: true });

module.exports = mongoose.model('Candidate', candidateSchema);
