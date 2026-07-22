const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Candidate = require('./models/Candidate');
const VoteReceipt = require('./models/Student');
const StudentRecord = require('./models/StudentRecord');
const StudentSource = require('./models/StudentSource');
const Announcement = require('./models/Announcement');
const Settings = require('./models/Settings');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const LEGACY_SHEET_ID = '1jbk3jOnvZKiiUf9AJaUc8pkExRPi6GFWnk_4h0CMn-o';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to the college portal database.'))
  .catch(error => console.error('Database connection error:', error.message));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function bearerToken(req) {
  return req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
}

function verifyAdmin(req, res, next) {
  try {
    const decoded = jwt.verify(bearerToken(req), JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Not an administrator');
    req.user = decoded;
    next();
  } catch (_) {
    res.status(401).json({ message: 'Your administrator session is invalid or has expired.' });
  }
}

function verifyStudent(req, res, next) {
  try {
    const decoded = jwt.verify(bearerToken(req), JWT_SECRET);
    if (decoded.role !== 'student' || !decoded.rollNumber) throw new Error('Not a student');
    req.user = decoded;
    next();
  } catch (_) {
    res.status(401).json({ message: 'Your student session is invalid or has expired.' });
  }
}

function extractSheetId(url) {
  const value = String(url || '').trim();
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(value) ? value : '';
}

function exportUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
}

function firstValue(row, names) {
  const normalized = Object.entries(row || {}).reduce((acc, [key, value]) => {
    acc[String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()] = value;
    return acc;
  }, {});
  for (const name of names) {
    const value = normalized[name.replace(/[^a-z0-9]/gi, '').toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function normalizeDob(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const parts = input.replace(/[./]/g, '-').split('-').map(part => part.trim());
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    return `${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[2]}`;
  }
  return input.toLowerCase();
}

function classNameFor(row, sheetTitle) {
  const explicit = firstValue(row, ['Class', 'ClassName', 'CourseClass']);
  if (explicit) return explicit;
  const department = firstValue(row, ['Department', 'Dept', 'Course']);
  const year = firstValue(row, ['Year', 'StudyYear']);
  const section = firstValue(row, ['Section', 'Sec']);
  return [department, year ? `Year ${year}` : '', section ? `Section ${section}` : ''].filter(Boolean).join(' · ') || sheetTitle || 'Unassigned';
}

async function ensureDefaultSource() {
  if (await StudentSource.countDocuments()) return;
  await StudentSource.create({
    name: 'Primary student register',
    url: `https://docs.google.com/spreadsheets/d/${LEGACY_SHEET_ID}/edit`,
    sheetId: LEGACY_SHEET_ID
  });
}

async function syncSource(source) {
  try {
    const response = await fetch(exportUrl(source.sheetId));
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const workbook = xlsx.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer', cellDates: false });
    const seenRolls = [];
    const classes = new Set();
    let imported = 0;

    for (const sheetTitle of workbook.SheetNames) {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetTitle], { raw: false, defval: '' });
      for (const row of rows) {
        const rollNumber = firstValue(row, ['RollNumber', 'RollNo', 'RegisterNumber', 'RegisterNo', 'StudentId', 'AdmissionNumber']).toUpperCase();
        const name = firstValue(row, ['Name', 'StudentName', 'FullName']);
        const dob = normalizeDob(firstValue(row, ['DOB', 'DateOfBirth', 'BirthDate']));
        if (!rollNumber || !name || !dob) continue;
        const className = classNameFor(row, sheetTitle);
        classes.add(className);
        seenRolls.push(rollNumber);
        await StudentRecord.findOneAndUpdate(
          { rollNumber },
          {
            sourceId: source._id, sheetTitle, className, rollNumber, name, dob,
            department: firstValue(row, ['Department', 'Dept', 'Course']),
            year: firstValue(row, ['Year', 'StudyYear']),
            section: firstValue(row, ['Section', 'Sec']),
            email: firstValue(row, ['Email', 'EmailAddress']), active: true
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        imported += 1;
      }
    }

    await StudentRecord.updateMany({ sourceId: source._id, rollNumber: { $nin: seenRolls } }, { active: false });
    source.lastSyncAt = new Date();
    source.lastError = '';
    source.studentCount = imported;
    source.classCount = classes.size;
    await source.save();
    return { imported, classes: [...classes] };
  } catch (error) {
    source.lastError = error.message;
    await source.save();
    throw error;
  }
}

async function ensureStudentDirectory() {
  if (await StudentRecord.countDocuments({ active: true })) return;
  await ensureDefaultSource();
  const sources = await StudentSource.find({ enabled: true });
  for (const source of sources) {
    try { await syncSource(source); } catch (error) { console.error(`Student sync failed: ${error.message}`); }
  }
}

function publicSettings(settings) {
  return settings || {
    isPublished: false, isCardVisible: false, cardTitle: '', cardDescription: '',
    collegeName: 'Kamaraj College', portalTitle: 'Student Campus Portal', academicYear: '2026-2027'
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'college-portal' }));

app.post('/api/admin/login', (req, res) => {
  const adminUser = process.env.ADMIN_USER || 'electionteam';
  const adminPass = process.env.ADMIN_PASS || 'fpc2k26';
  if (req.body.username !== adminUser || req.body.password !== adminPass) {
    return res.status(401).json({ message: 'Invalid administrator credentials.' });
  }
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
});

app.get('/api/portal/public', async (_req, res) => {
  try {
    const [settings, announcements] = await Promise.all([
      Settings.findOne({ settingsId: 'master_config' }).lean(),
      Announcement.find({ published: true, publishAt: { $lte: new Date() }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ priority: 1, publishAt: -1 }).limit(8).lean()
    ]);
    res.json({ settings: publicSettings(settings), announcements });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/admin/settings', async (_req, res) => {
  try { res.json(publicSettings(await Settings.findOne({ settingsId: 'master_config' }))); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/admin/settings', verifyAdmin, async (req, res) => {
  try {
    const allowed = ['isPublished', 'cardTitle', 'cardDescription', 'isCardVisible', 'collegeName', 'portalTitle', 'supportEmail', 'academicYear'];
    const updates = Object.fromEntries(allowed.filter(key => req.body[key] !== undefined).map(key => [key, req.body[key]]));
    const settings = await Settings.findOneAndUpdate({ settingsId: 'master_config' }, { $set: updates }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ message: 'Portal settings updated.', settings });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/student/login', async (req, res) => {
  try {
    await ensureStudentDirectory();
    const rollNumber = String(req.body.rollNumber || '').trim().toUpperCase();
    const dob = normalizeDob(req.body.dob);
    const student = await StudentRecord.findOne({ rollNumber, dob, active: true });
    if (!student) return res.status(401).json({ message: 'Roll number or date of birth is incorrect.' });
    const hasVoted = Boolean(await VoteReceipt.exists({ rollNumber }));
    res.json({
      token: jwt.sign({ role: 'student', rollNumber }, JWT_SECRET, { expiresIn: '30d' }),
      student: { name: student.name, rollNumber, className: student.className, department: student.department, year: student.year, section: student.section, hasVoted }
    });
  } catch (error) { res.status(500).json({ message: 'Unable to verify the student directory.', detail: error.message }); }
});

app.get('/api/student/me', verifyStudent, async (req, res) => {
  const student = await StudentRecord.findOne({ rollNumber: req.user.rollNumber, active: true }).lean();
  if (!student) return res.status(404).json({ message: 'Student record is no longer active.' });
  const hasVoted = Boolean(await VoteReceipt.exists({ rollNumber: req.user.rollNumber }));
  res.json({ ...student, hasVoted });
});

app.get('/api/student/announcements', verifyStudent, async (_req, res) => {
  const now = new Date();
  res.json(await Announcement.find({ published: true, audience: { $in: ['ALL', 'STUDENTS'] }, publishAt: { $lte: now }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).sort({ publishAt: -1 }));
});

app.post('/api/candidates', verifyAdmin, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Candidate photo is required.' });
    const candidate = await Candidate.create({
      name: req.body.name, posting: req.body.posting, department: req.body.department,
      year: Number(req.body.year), section: req.body.section || 'None', description: String(req.body.description || '').trim(),
      photo: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    });
    res.status(201).json({ message: 'Candidate added.', candidate });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/candidates', async (_req, res) => {
  try { res.json(await Candidate.find().select('-votes')); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/admin/candidates', verifyAdmin, async (_req, res) => {
  try { res.json(await Candidate.find()); } catch (error) { res.status(500).json({ message: error.message }); }
});

app.put('/api/candidates/:id', verifyAdmin, upload.single('photo'), async (req, res) => {
  try {
    const update = { name: req.body.name, posting: req.body.posting, department: req.body.department, year: Number(req.body.year), section: req.body.section || 'None', description: String(req.body.description || '').trim() };
    if (req.file) update.photo = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    res.json({ message: 'Candidate updated.', candidate: await Candidate.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.delete('/api/candidates/:id', verifyAdmin, async (req, res) => {
  try { await Candidate.findByIdAndDelete(req.params.id); res.json({ message: 'Candidate removed.' }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/student/vote', verifyStudent, async (req, res) => {
  try {
    const rollNumber = req.user.rollNumber;
    if (await VoteReceipt.exists({ rollNumber })) return res.status(409).json({ message: 'Your ballot has already been submitted.' });
    const settings = await Settings.findOne({ settingsId: 'master_config' });
    if (!settings?.isPublished) return res.status(400).json({ message: 'Voting is currently closed.' });
    const candidateIds = [...new Set((req.body.candidateIds || []).map(String))];
    const candidates = await Candidate.find({ _id: { $in: candidateIds } });
    const allPostings = await Candidate.distinct('posting');
    if (candidates.length !== candidateIds.length || new Set(candidates.map(c => c.posting.toUpperCase())).size !== allPostings.length) {
      return res.status(400).json({ message: 'Select exactly one candidate for every position.' });
    }
    const student = await StudentRecord.findOne({ rollNumber });
    await VoteReceipt.create({ rollNumber, name: student?.name || req.body.studentName, candidateIds });
    await Candidate.updateMany({ _id: { $in: candidateIds } }, { $inc: { votes: 1 } });
    res.json({ message: 'Your ballot was submitted successfully.' });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Your ballot has already been submitted.' });
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/stats', verifyAdmin, async (_req, res) => {
  const [totalStudents, totalVotes, totalCandidates, totalAnnouncements, totalClasses] = await Promise.all([
    StudentRecord.countDocuments({ active: true }), VoteReceipt.countDocuments(), Candidate.countDocuments(),
    Announcement.countDocuments({ published: true }), StudentRecord.distinct('className', { active: true })
  ]);
  res.json({ totalStudents, totalVotes, totalCandidates, totalAnnouncements, totalClasses: totalClasses.length });
});

app.get('/api/admin/students', verifyAdmin, async (req, res) => {
  const query = { active: true };
  if (req.query.className) query.className = req.query.className;
  const [students, votedRolls] = await Promise.all([StudentRecord.find(query).sort({ className: 1, name: 1 }).lean(), VoteReceipt.distinct('rollNumber')]);
  const voted = new Set(votedRolls);
  res.json(students.map(student => ({ ...student, hasVoted: voted.has(student.rollNumber) })));
});

app.get('/api/admin/classes', verifyAdmin, async (_req, res) => {
  const groups = await StudentRecord.aggregate([{ $match: { active: true } }, { $group: { _id: '$className', count: { $sum: 1 }, sheets: { $addToSet: '$sheetTitle' } } }, { $sort: { _id: 1 } }]);
  res.json(groups.map(group => ({ className: group._id, count: group.count, sheets: group.sheets })));
});

app.get('/api/admin/sources', verifyAdmin, async (_req, res) => {
  await ensureDefaultSource();
  res.json(await StudentSource.find().sort({ createdAt: 1 }));
});

app.post('/api/admin/sources', verifyAdmin, async (req, res) => {
  const sheetId = extractSheetId(req.body.url);
  if (!sheetId) return res.status(400).json({ message: 'Enter a valid Google Sheets link.' });
  try {
    const source = await StudentSource.create({ name: req.body.name || 'Student register', url: req.body.url, sheetId, enabled: true });
    const result = await syncSource(source);
    res.status(201).json({ message: `Imported ${result.imported} students from ${result.classes.length} classes.`, source });
  } catch (error) { res.status(400).json({ message: `The sheet could not be imported: ${error.message}` }); }
});

app.post('/api/admin/sources/:id/sync', verifyAdmin, async (req, res) => {
  try {
    const source = await StudentSource.findById(req.params.id);
    if (!source) return res.status(404).json({ message: 'Spreadsheet source not found.' });
    const result = await syncSource(source);
    res.json({ message: `Synced ${result.imported} students across ${result.classes.length} classes.`, result });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.delete('/api/admin/sources/:id', verifyAdmin, async (req, res) => {
  await StudentRecord.deleteMany({ sourceId: req.params.id });
  await StudentSource.findByIdAndDelete(req.params.id);
  res.json({ message: 'Spreadsheet source and its imported directory entries were removed.' });
});

app.get('/api/admin/announcements', verifyAdmin, async (_req, res) => res.json(await Announcement.find().sort({ createdAt: -1 })));
app.post('/api/admin/announcements', verifyAdmin, async (req, res) => {
  try { res.status(201).json(await Announcement.create(req.body)); }
  catch (error) { res.status(400).json({ message: error.message }); }
});
app.put('/api/admin/announcements/:id', verifyAdmin, async (req, res) => {
  try { res.json(await Announcement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })); }
  catch (error) { res.status(400).json({ message: error.message }); }
});
app.delete('/api/admin/announcements/:id', verifyAdmin, async (req, res) => {
  await Announcement.findByIdAndDelete(req.params.id); res.json({ message: 'Announcement deleted.' });
});

app.get('/api/results/final', async (_req, res) => {
  const [totalStudents, totalVotes] = await Promise.all([StudentRecord.countDocuments({ active: true }), VoteReceipt.countDocuments()]);
  if (!totalStudents || totalVotes < totalStudents) return res.json({ isComplete: false, totalStudents, totalVotes, winners: [] });
  const candidates = await Candidate.find().sort({ posting: 1, votes: -1, name: 1 }).lean();
  const grouped = candidates.reduce((all, candidate) => ((all[candidate.posting] ||= []).push(candidate), all), {});
  const winners = Object.entries(grouped).flatMap(([posting, items]) => {
    const high = Math.max(...items.map(item => item.votes || 0));
    const tied = items.filter(item => (item.votes || 0) === high);
    return tied.map(item => ({ ...item, posting, isTie: tied.length > 1 }));
  });
  res.json({ isComplete: true, totalStudents, totalVotes, winners });
});

app.get('/api/admin/download-results', verifyAdmin, async (_req, res) => {
  const [candidates, receipts] = await Promise.all([Candidate.find().sort({ posting: 1, votes: -1 }), VoteReceipt.find().sort({ votedAt: 1 })]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(candidates.map(c => ({ Name: c.name, Position: c.posting, Department: c.department, Votes: c.votes }))), 'Election Results');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(receipts.map(r => ({ RollNumber: r.rollNumber, Name: r.name, VotedAt: r.votedAt }))), 'Participation');
  res.setHeader('Content-Disposition', 'attachment; filename="College_Portal_Election_Results.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
});

app.post('/api/admin/reset-election', verifyAdmin, async (req, res) => {
  if (String(req.body.confirmationCode || '').trim().toUpperCase() !== 'RESET') return res.status(400).json({ message: 'Type RESET to confirm.' });
  const receiptResult = await VoteReceipt.deleteMany({});
  await Candidate.updateMany({}, { votes: 0 });
  res.json({ message: 'Election participation and vote totals were reset. Student accounts and candidates were kept.', deletedReceipts: receiptResult.deletedCount });
});

app.listen(PORT, () => console.log(`College portal API running on port ${PORT}`));
