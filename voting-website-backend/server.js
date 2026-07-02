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

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ==========================================
// MONGODB CONNECTION
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB Atlas.'))
  .catch((error) => console.error('Database connection error:', error.message));

// ==========================================
// LIVE EXCEL READER HELPER
// ==========================================
// Reads the Excel file fresh every time it's called
function getExcelStudents() {
  const excelPath = path.join(__dirname, 'data', 'students.xlsx');
  if (!fs.existsSync(excelPath)) return [];
  try {
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false });
  } catch (err) {
    console.error('Error reading Excel:', err.message);
    return [];
  }
}

// ==========================================
// MULTER (Photo Uploads)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// ==========================================
// CANDIDATE ROUTES
// ==========================================
app.post('/api/candidates', upload.single('photo'), async (req, res) => {
  try {
    const { name, posting, department, year, section } = req.body;
    if (!req.file) return res.status(400).json({ message: 'Photo required.' });
    const newCandidate = new Candidate({
      name, posting, department, year: Number(year), section: section || 'None', photo: `/uploads/${req.file.filename}`
    });
    await newCandidate.save();
    res.status(201).json({ message: 'Added successfully!', candidate: newCandidate });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/candidates', async (req, res) => {
  try { res.json(await Candidate.find()); } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/candidates/:id', async (req, res) => {
  try {
    await Candidate.findByIdAndUpdate(req.params.id, { name: req.body.name, posting: req.body.posting });
    res.json({ message: 'Updated' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/candidates/:id', async (req, res) => {
  try {
    const cand = await Candidate.findById(req.params.id);
    if (cand && cand.photo) {
      const filePath = path.join(__dirname, cand.photo);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await Candidate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// ADMIN ROUTES
// ==========================================
app.get('/api/admin/stats', async (req, res) => {
  try {
    const excelStudents = getExcelStudents();
    res.json({
      totalStudents: excelStudents.length, // Reads live count from Excel
      totalVotes: await Student.countDocuments(), // Reads total voter receipts in DB
      totalCandidates: await Candidate.countDocuments()
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// NEW: Combines live Excel data with MongoDB Voting Receipts
app.get('/api/admin/students', async (req, res) => {
  try {
    const excelStudents = getExcelStudents();
    // Get list of everyone who has voted from the DB
    const votedStudents = await Student.find({}, 'rollNumber');
    const votedSet = new Set(votedStudents.map(s => String(s.rollNumber).toUpperCase()));

    // Merge the data
    const directory = excelStudents.map(stu => ({
      name: stu.Name,
      rollNumber: String(stu.RollNumber).toUpperCase(),
      hasVoted: votedSet.has(String(stu.RollNumber).toUpperCase())
    }));
    
    res.json(directory);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await Settings.findOne({ settingsId: 'master_config' });
    res.json(settings || { isPublished: false, startTime: null, endTime: null });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const { isPublished, startTime, endTime } = req.body;
    let settings = await Settings.findOne({ settingsId: 'master_config' });
    if (!settings) settings = new Settings({ isPublished, startTime, endTime });
    else { settings.isPublished = isPublished; settings.startTime = startTime; settings.endTime = endTime; }
    await settings.save();
    res.json({ message: 'Updated', settings });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// NUCLEAR WIPE
app.delete('/api/admin/wipe-all', async (req, res) => {
   try {
       await Student.deleteMany({}); // Destroys all voting receipts
       
       const dir = 'uploads/';
       fs.readdir(dir, (err, files) => {
         if (!err) {
           for (const file of files) {
             if(file !== '.gitkeep') fs.unlink(path.join(dir, file), err => { if (err) console.error(err); });
           }
         }
       });

       await Candidate.deleteMany({});
       res.json({ message: 'System completely wiped.' });
   } catch(error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/download-results', async (req, res) => {
  try {
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
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// STUDENT ROUTES
// ==========================================
// LIVE EXCEL LOGIN: Reads directly from Excel on every login attempt!
app.post('/api/student/login', async (req, res) => {
   try {
       const { rollNumber, dob } = req.body;
       const students = getExcelStudents();
       
       const student = students.find(s => 
           String(s.RollNumber).toUpperCase() === String(rollNumber).toUpperCase() &&
           String(s.DOB).trim() === String(dob).trim()
       );

       if (!student) return res.status(401).json({ message: 'Invalid Roll Number or Date of Birth' });
       
       res.json({ 
           message: 'Login successful', 
           token: jwt.sign({ rollNumber: student.RollNumber }, JWT_SECRET, { expiresIn: '2h' }), 
           student: { name: student.Name, rollNumber: String(student.RollNumber).toUpperCase() } 
       });
   } catch (error) { res.status(500).json({ error: error.message }); }
});

// SUBMIT BALLOT: Creates a "Voter Receipt" in MongoDB using the Roll Number
app.post('/api/student/vote', async (req, res) => {
   try {
       const { rollNumber, studentName, candidateIds } = req.body; 
       
       // 1. Check if they already have a receipt in the DB
       const existingVote = await Student.findOne({ rollNumber: rollNumber });
       if (existingVote) return res.status(400).json({ message: 'You have already voted!' });
       
       // 2. Check timing
       const settings = await Settings.findOne({ settingsId: 'master_config' });
       const now = new Date();
       if (!settings || !settings.isPublished || now < new Date(settings.startTime) || now > new Date(settings.endTime)) {
           return res.status(400).json({ message: 'Voting is currently closed.' });
       }

       // 3. Create the receipt & Increment votes
       await Student.create({ rollNumber: rollNumber, name: studentName, hasVoted: true });
       await Candidate.updateMany({ _id: { $in: candidateIds } }, { $inc: { votes: 1 } });
       
       res.json({ message: 'Ballot successfully cast!' });
   } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));