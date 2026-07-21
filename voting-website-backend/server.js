const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Candidate = require('./models/Candidate');
const Student = require('./models/Student');
const Settings = require('./models/Settings');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// GOOGLE SHEET ID
const SHEET_ID = '1jbk3jOnvZKiiUf9AJaUc8pkExRPi6GFWnk_4h0CMn-o';
const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

app.use(cors());
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB Atlas.'))
  .catch((error) => console.error('Database connection error:', error.message));

async function getExcelStudents() {
  try {
    const response = await fetch(GOOGLE_SHEET_URL);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false });
  } catch (err) {
    console.error('Error fetching Google Sheet:', err.message);
    return [];
  }
}

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const verifyAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Access Denied. No token provided.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') throw new Error('Not admin');
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid or Expired Admin Token.' });
    }
};

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USER || 'electionteam';
    const adminPass = process.env.ADMIN_PASS || 'fpc2k26';

    if (username === adminUser && password === adminPass) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ message: 'Login successful', token });
    } else {
        res.status(401).json({ message: 'Invalid Admin Credentials' });
    }
});

// CREATE CANDIDATE
app.post('/api/candidates', verifyAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { name, posting, department, year, section, description } = req.body;
    if (!req.file) return res.status(400).json({ message: 'Photo required.' });
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const newCandidate = new Candidate({ name, posting, department, year: Number(year), section: section || 'None', description: (description || '').trim(), photo: base64Image });
    await newCandidate.save();
    res.status(201).json({ message: 'Added successfully!', candidate: newCandidate });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// GET CANDIDATES
app.get('/api/candidates', async (req, res) => {
  try { res.json(await Candidate.find().select('-votes')); } catch (error) { res.status(500).json({ error: error.message }); }
});

// Vote totals remain available only to an authenticated administrator.
app.get('/api/admin/candidates', verifyAdmin, async (req, res) => {
  try { res.json(await Candidate.find()); } catch (error) { res.status(500).json({ error: error.message }); }
});

// NEW: UPDATE (EDIT) CANDIDATE
app.put('/api/candidates/:id', verifyAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { name, posting, department, year, section, description } = req.body;
    let updateData = { name, posting, department, year: Number(year), section: section || 'None', description: (description || '').trim() };
    
    // Only update the photo if a new one was uploaded
    if (req.file) {
      updateData.photo = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const updatedCandidate = await Candidate.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ message: 'Updated successfully!', candidate: updatedCandidate });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE CANDIDATE
app.delete('/api/candidates/:id', verifyAdmin, async (req, res) => {
  try {
    await Candidate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const excelStudents = await getExcelStudents();
    res.json({
      totalStudents: excelStudents.length,
      totalVotes: await Student.countDocuments(),
      totalCandidates: await Candidate.countDocuments()
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/students', verifyAdmin, async (req, res) => {
  try {
    const excelStudents = await getExcelStudents();
    const votedStudents = await Student.find({}, 'rollNumber');
    const votedSet = new Set(votedStudents.map(s => String(s.rollNumber).toUpperCase()));
    const directory = excelStudents.map(stu => ({
      name: stu.Name,
      rollNumber: String(stu.RollNumber).toUpperCase(),
      hasVoted: votedSet.has(String(stu.RollNumber).toUpperCase())
    }));
    res.json(directory);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Public final results are released only after every eligible student has voted.
app.get('/api/results/final', async (req, res) => {
  try {
    const excelStudents = await getExcelStudents();
    const eligibleRolls = new Set(
      excelStudents
        .map(student => String(student.RollNumber || '').trim().toUpperCase())
        .filter(Boolean)
    );

    const recordedRolls = await Student.distinct('rollNumber');
    const completedRolls = new Set(
      recordedRolls
        .map(roll => String(roll || '').trim().toUpperCase())
        .filter(roll => eligibleRolls.has(roll))
    );

    const totalStudents = eligibleRolls.size;
    const totalVotes = completedRolls.size;
    const isComplete = totalStudents > 0 && totalVotes === totalStudents;

    if (!isComplete) {
      return res.json({ isComplete: false, totalStudents, totalVotes, winners: [] });
    }

    const candidates = await Candidate.find().sort({ posting: 1, votes: -1, name: 1 }).lean();
    const grouped = candidates.reduce((groups, candidate) => {
      const posting = String(candidate.posting || 'Unknown').trim().toUpperCase();
      if (!groups[posting]) groups[posting] = [];
      groups[posting].push(candidate);
      return groups;
    }, {});

    const winners = Object.entries(grouped).flatMap(([posting, postingCandidates]) => {
      const highestVotes = Math.max(...postingCandidates.map(candidate => Number(candidate.votes) || 0));
      return postingCandidates
        .filter(candidate => (Number(candidate.votes) || 0) === highestVotes)
        .map(candidate => ({
          id: candidate._id,
          name: candidate.name,
          posting,
          department: candidate.department,
          year: candidate.year,
          section: candidate.section,
          description: candidate.description || '',
          photo: candidate.photo,
          votes: candidate.votes,
          isTie: postingCandidates.filter(item => (Number(item.votes) || 0) === highestVotes).length > 1
        }));
    });

    res.json({ isComplete: true, totalStudents, totalVotes, winners });
  } catch (error) {
    console.error('Final results check failed:', error);
    res.status(500).json({ message: 'Unable to verify final election results.' });
  }
});

app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await Settings.findOne({ settingsId: 'master_config' });
    res.json(settings || { isPublished: false });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/settings', verifyAdmin, async (req, res) => {
  try {
    const { isPublished, cardTitle, cardDescription, isCardVisible } = req.body;
    let settings = await Settings.findOne({ settingsId: 'master_config' });
    if (!settings) {
      settings = new Settings({ isPublished, cardTitle, cardDescription, isCardVisible });
    } else {
      if (isPublished !== undefined) settings.isPublished = isPublished;
      if (cardTitle !== undefined) settings.cardTitle = cardTitle;
      if (cardDescription !== undefined) settings.cardDescription = cardDescription;
      if (isCardVisible !== undefined) settings.isCardVisible = isCardVisible;
    }
    await settings.save();
    res.json({ message: 'Updated', settings });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

const resetElectionData = async (req, res) => {
  try {
    const confirmationCode = String(req.body?.confirmationCode || '').trim().toUpperCase();
    if (confirmationCode !== 'PURGE') {
      return res.status(400).json({ message: 'Invalid confirmation code. Type PURGE to continue.' });
    }

    const [studentResult, candidateResult] = await Promise.all([
      Student.deleteMany({}),
      Candidate.deleteMany({})
    ]);

    res.json({
      message: 'Election data was completely wiped.',
      deletedStudents: studentResult.deletedCount,
      deletedCandidates: candidateResult.deletedCount
    });
  } catch (error) {
    console.error('Election reset failed:', error);
    res.status(500).json({ message: 'Database reset failed.', error: error.message });
  }
};

// Current endpoint used by the administration portal.
app.post('/api/admin/reset-election', verifyAdmin, resetElectionData);

// Legacy alias; it uses the same authorization and PURGE verification.
app.delete('/api/admin/wipe-all', verifyAdmin, resetElectionData);

app.get('/api/admin/download-results', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send('Access Denied');
    jwt.verify(token, JWT_SECRET); 

    const candidates = await Candidate.find().sort({ votes: -1 });
    const candidateData = candidates.map(c => ({ Name: c.name, Posting: c.posting, Department: c.department, TotalVotes: c.votes }));
    
    const students = await Student.find();
    const voterData = students.map(s => ({ Name: s.name, RollNumber: s.rollNumber, Status: "Successfully Voted" }));

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(candidateData), "Results");
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(voterData), "Voter Log");

    res.setHeader('Content-Disposition', 'attachment; filename="Election_Results.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  } catch (error) { res.status(401).send('Invalid Token or Error generating report'); }
});

app.post('/api/student/login', async (req, res) => {
   try {
       const { rollNumber, dob } = req.body;
       const cleanRoll = String(rollNumber).toUpperCase().trim();
       
       const existingVote = await Student.findOne({ rollNumber: cleanRoll });
       if (existingVote) return res.status(403).json({ message: 'You have already cast your ballot. Multiple votes are not allowed.' });

       const students = await getExcelStudents();
       const student = students.find(s => 
           String(s.RollNumber).toUpperCase().trim() === cleanRoll &&
           String(s.DOB).trim() === String(dob).trim()
       );

       if (!student) return res.status(401).json({ message: 'Invalid Roll Number or Date of Birth' });
       
       res.json({ 
           message: 'Login successful', 
           token: jwt.sign({ rollNumber: student.RollNumber }, JWT_SECRET, { expiresIn: '2h' }), 
           student: { name: student.Name, rollNumber: cleanRoll } 
       });
   } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/student/vote', async (req, res) => {
   try {
       const { rollNumber, studentName, candidateIds } = req.body; 
       const cleanRoll = String(rollNumber).toUpperCase().trim();
       
       const existingVote = await Student.findOne({ rollNumber: cleanRoll });
       if (existingVote) return res.status(400).json({ message: 'You have already voted!' });
       
       const settings = await Settings.findOne({ settingsId: 'master_config' });
       
       if (!settings || !settings.isPublished) {
           return res.status(400).json({ message: 'Voting is currently closed.' });
       }

       await Student.create({ rollNumber: cleanRoll, name: studentName, hasVoted: true });
       await Candidate.updateMany({ _id: { $in: candidateIds } }, { $inc: { votes: 1 } });
       
       res.json({ message: 'Ballot successfully cast!' });
   } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
