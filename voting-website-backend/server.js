const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');
require('dotenv').config();

const Candidate = require('./models/Candidate');
const VoteReceipt = require('./models/Student');
const StudentSource = require('./models/StudentSource');
const Announcement = require('./models/Announcement');
const Settings = require('./models/Settings');
const Timetable = require('./models/Timetable');
const PushConfig = require('./models/PushConfig');
const PushSubscription = require('./models/PushSubscription');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const RELEASE = '2026-07-28-live-class-sheets-v2';
const STUDENT_SYNC_INTERVAL_MS = Math.max(Number(process.env.STUDENT_SYNC_INTERVAL_MS) || 120000, 30000);
const ANNOUNCEMENT_PUSH_INTERVAL_MS = Math.max(Number(process.env.ANNOUNCEMENT_PUSH_INTERVAL_MS) || 60000, 15000);
const DEFAULT_STUDENT_SOURCES = [
  {
    name: 'Student register 1',
    sheetId: '1iWZ4NNXFJ5_SLfQKYl03AVIOvMRJciQCeS5jnV7KDHc',
    url: 'https://docs.google.com/spreadsheets/d/1iWZ4NNXFJ5_SLfQKYl03AVIOvMRJciQCeS5jnV7KDHc/edit?usp=sharing'
  },
  {
    name: 'Student register 2',
    sheetId: '1PcltlJ4yQa8Ak8LiEI6mlX4LpQ_UQaWRu-uS5y-0gwE',
    url: 'https://docs.google.com/spreadsheets/d/1PcltlJ4yQa8Ak8LiEI6mlX4LpQ_UQaWRu-uS5y-0gwE/edit?usp=sharing'
  },
  {
    name: 'Student register 3',
    sheetId: '1P-e1gW0jSkT_fIT1Nh9cVMSqt6CPdo2U9y-OCMwfMII',
    url: 'https://docs.google.com/spreadsheets/d/1P-e1gW0jSkT_fIT1Nh9cVMSqt6CPdo2U9y-OCMwfMII/edit?usp=sharing'
  },
  {
    name: 'Student register 4',
    sheetId: '1kCK1rBl1WF4xw-T-qCRBj-ImB-F7gFFnnWQQWK5rKhU',
    url: 'https://docs.google.com/spreadsheets/d/1kCK1rBl1WF4xw-T-qCRBj-ImB-F7gFFnnWQQWK5rKhU/edit?gid=0#gid=0'
  }
];

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to the college portal database.');
    try { await refreshStudentDirectory({ force: true }); }
    catch (error) { console.error(`Initial student sync failed: ${error.message}`); }
    const timer = setInterval(() => {
      refreshStudentDirectory({ force: true })
        .catch(error => console.error(`Scheduled student sync failed: ${error.message}`));
    }, STUDENT_SYNC_INTERVAL_MS);
    timer.unref();
    notifyLiveAnnouncements().catch(error => console.error(`Initial announcement push failed: ${error.message}`));
    const announcementTimer = setInterval(() => {
      notifyLiveAnnouncements().catch(error => console.error(`Scheduled announcement push failed: ${error.message}`));
    }, ANNOUNCEMENT_PUSH_INTERVAL_MS);
    announcementTimer.unref();
  })
  .catch(error => console.error('Database connection error:', error.message));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(file.mimetype.startsWith('image/') ? null : new Error('Only image files are allowed.'), file.mimetype.startsWith('image/'))
});

function safeExternalUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported link');
    return url.toString();
  } catch (_) {
    throw new Error('Announcement links must begin with http:// or https://.');
  }
}

let webPushConfigPromise = null;

async function getWebPushConfig() {
  if (!webPushConfigPromise) {
    webPushConfigPromise = (async () => {
      let config = await PushConfig.findOne({ configId: 'web_push' });
      if (!config) {
        const keys = webPush.generateVAPIDKeys();
        config = await PushConfig.findOneAndUpdate(
          { configId: 'web_push' },
          { $setOnInsert: { configId: 'web_push', publicKey: keys.publicKey, privateKey: keys.privateKey } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
      webPush.setVapidDetails(
        process.env.WEB_PUSH_CONTACT || 'mailto:portal@kamarajcollege.ac.in',
        config.publicKey,
        config.privateKey
      );
      return config;
    })().catch(error => {
      webPushConfigPromise = null;
      throw error;
    });
  }
  return webPushConfigPromise;
}

async function notifyAnnouncementIfLive(announcementId) {
  const now = new Date();
  const announcement = await Announcement.findOneAndUpdate({
    _id: announcementId,
    pushNotifiedAt: null,
    published: true,
    publishAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }, { $set: { pushNotifiedAt: now } }, { new: true }).lean();
  if (!announcement) return false;

  const subscriptionQuery = { active: true };
  if (announcement.targetClasses?.length) subscriptionQuery.className = { $in: announcement.targetClasses };
  const subscriptions = await PushSubscription.find(subscriptionQuery).lean();
  if (!subscriptions.length) return true;

  await getWebPushConfig();
  const payload = JSON.stringify({
    title: announcement.title,
    body: announcement.body.length > 240 ? `${announcement.body.slice(0, 237)}...` : announcement.body,
    priority: announcement.priority,
    tag: `announcement-${announcement._id}`,
    url: './dashboard.html#announcements'
  });
  const staleIds = [];
  await Promise.all(subscriptions.map(async subscription => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: subscription.keys
      }, payload, { TTL: 24 * 60 * 60, urgency: announcement.priority === 'URGENT' ? 'high' : 'normal' });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) staleIds.push(subscription._id);
      else console.error(`Announcement push delivery failed: ${error.message}`);
    }
  }));
  if (staleIds.length) await PushSubscription.deleteMany({ _id: { $in: staleIds } });
  return true;
}

async function notifyLiveAnnouncements() {
  const now = new Date();
  const announcements = await Announcement.find({
    pushNotifiedAt: null,
    published: true,
    publishAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }).select('_id').lean();
  await Promise.all(announcements.map(item => notifyAnnouncementIfLive(item._id)));
}

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

function classDetailsFor(sheetTitle) {
  const className = String(sheetTitle || '').trim() || 'Unassigned';
  const year = className.slice(0, 3).trim();
  const department = className.slice(3).trim() || className;
  return { className, sheetTitle: className, year, department, section: '' };
}

function studentView(student) {
  return {
    name: student.name,
    rollNumber: student.rollNumber,
    className: student.className,
    sheetTitle: student.sheetTitle,
    department: student.department,
    year: student.year,
    section: student.section,
    email: student.email
  };
}

function sheetDocumentTitle(response, workbook, fallback = 'Student Register') {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
  let title = workbook?.Props?.Title || '';
  try {
    if (utf8Match) title = decodeURIComponent(utf8Match[1]);
    else if (basicMatch) title = basicMatch[1];
  } catch (_) { /* keep workbook title or fallback */ }
  title = String(title || fallback).replace(/\.xlsx$/i, '').trim();
  return title || fallback;
}

function meaningfulSheetTitle(sheetTitle, documentTitle) {
  const tabTitle = String(sheetTitle || '').trim();
  const fileTitle = String(documentTitle || '').trim();
  const classTitle = /^\d(?:st|nd|rd|th)\s+.+/i;
  if (classTitle.test(tabTitle)) return tabTitle;
  if (classTitle.test(fileTitle)) return fileTitle;
  const generic = /^(sheet|worksheet|tab)(\s*\d+)?$/i.test(tabTitle);
  return generic ? fileTitle : tabTitle;
}

async function ensureDefaultSources() {
  await Promise.all(DEFAULT_STUDENT_SOURCES.map(source => StudentSource.findOneAndUpdate(
    { sheetId: source.sheetId },
    { $setOnInsert: { ...source, enabled: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )));
}

const studentDirectoryBySource = new Map();
const classDirectoryBySource = new Map();
let studentDirectorySyncPromise = null;
let lastStudentDirectorySyncAt = 0;

function currentStudentDirectory() {
  const byRollNumber = new Map();
  for (const students of studentDirectoryBySource.values()) {
    for (const student of students) byRollNumber.set(student.rollNumber, student);
  }
  return [...byRollNumber.values()].sort((a, b) => (
    a.sourceOrder - b.sourceOrder ||
    a.sheetOrder - b.sheetOrder ||
    a.sourceRow - b.sourceRow
  ));
}

function currentClassDirectory() {
  const groups = new Map();
  for (const classes of classDirectoryBySource.values()) {
    for (const item of classes) {
      if (!groups.has(item.className)) {
        groups.set(item.className, {
          className: item.className,
          year: item.year,
          count: 0,
          sheets: [item.sheetTitle],
          departments: [item.department],
          sourceOrder: item.sourceOrder,
          sheetOrder: item.sheetOrder
        });
      }
    }
  }
  for (const student of currentStudentDirectory()) {
    const group = groups.get(student.className);
    if (group) group.count += 1;
  }
  return [...groups.values()]
    .sort((a, b) => a.sourceOrder - b.sourceOrder || a.sheetOrder - b.sheetOrder)
    .map(({ sourceOrder, sheetOrder, ...group }) => group);
}

async function syncSource(source) {
  try {
    const response = await fetch(exportUrl(source.sheetId), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
    const workbook = xlsx.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer', cellDates: false });
    const documentTitle = sheetDocumentTitle(response, workbook, source.name);
    const classes = new Set();
    const sourceClasses = [];
    const students = [];
    const defaultSourceOrder = DEFAULT_STUDENT_SOURCES.findIndex(item => item.sheetId === source.sheetId);
    const sourceOrder = defaultSourceOrder < 0 ? DEFAULT_STUDENT_SOURCES.length : defaultSourceOrder;

    for (const [sheetOrder, sheetTitle] of workbook.SheetNames.entries()) {
      const displayTitle = meaningfulSheetTitle(sheetTitle, documentTitle);
      const classDetails = classDetailsFor(displayTitle);
      classes.add(classDetails.className);
      sourceClasses.push({ ...classDetails, sourceOrder, sheetOrder });
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetTitle], { raw: false, defval: '' });
      for (const [sourceRow, row] of rows.entries()) {
        const rollNumber = firstValue(row, ['RollNumber', 'RollNo', 'RegisterNumber', 'RegisterNo', 'StudentId', 'AdmissionNumber']).toUpperCase();
        const name = firstValue(row, ['Name', 'StudentName', 'FullName']);
        const dob = normalizeDob(firstValue(row, ['DOB', 'DateOfBirth', 'BirthDate']));
        if (!rollNumber || !name || !dob) continue;
        students.push({
          sourceId: String(source._id),
          sourceName: source.name,
          sourceOrder,
          sheetOrder,
          sourceRow,
          rollNumber,
          name,
          dob,
          email: firstValue(row, ['Email', 'EmailAddress']),
          active: true,
          ...classDetails
        });
      }
    }

    studentDirectoryBySource.set(source.sheetId, students);
    classDirectoryBySource.set(source.sheetId, sourceClasses);
    source.lastSyncAt = new Date();
    if (/^(Primary )?student register(?: \d+)?$/i.test(source.name)) source.name = documentTitle;
    source.lastError = '';
    source.studentCount = students.length;
    source.classCount = classes.size;
    await source.save().catch(error => console.error(`Spreadsheet metadata could not be saved: ${error.message}`));
    return { imported: students.length, classes: [...classes], students };
  } catch (error) {
    source.lastError = error.message;
    await source.save().catch(saveError => console.error(`Spreadsheet error status could not be saved: ${saveError.message}`));
    throw error;
  }
}

async function refreshStudentDirectory({ force = false } = {}) {
  if (!force && Date.now() - lastStudentDirectorySyncAt < STUDENT_SYNC_INTERVAL_MS) {
    const students = currentStudentDirectory();
    return { students, freshStudents: students, synced: 0, failed: 0, errors: [] };
  }
  if (!studentDirectorySyncPromise) {
    studentDirectorySyncPromise = (async () => {
      await ensureDefaultSources();
      const sources = await StudentSource.find({ enabled: true }).sort({ createdAt: 1 });
      const enabledIds = new Set(sources.map(source => source.sheetId));
      for (const sourceId of studentDirectoryBySource.keys()) {
        if (!enabledIds.has(sourceId)) {
          studentDirectoryBySource.delete(sourceId);
          classDirectoryBySource.delete(sourceId);
        }
      }

      const results = await Promise.allSettled(sources.map(source => syncSource(source)));
      const errors = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [];
        const message = `${sources[index].name}: ${result.reason.message}`;
        console.error(`Student sync failed for ${message}`);
        return [message];
      });
      const freshStudents = results.flatMap(result => (
        result.status === 'fulfilled' ? result.value.students : []
      ));
      if (freshStudents.length || !sources.length) lastStudentDirectorySyncAt = Date.now();
      return {
        students: currentStudentDirectory(),
        freshStudents,
        synced: results.length - errors.length,
        failed: errors.length,
        errors
      };
    })().finally(() => { studentDirectorySyncPromise = null; });
  }
  return studentDirectorySyncPromise;
}

async function getStudentDirectory({ force = false } = {}) {
  const result = await refreshStudentDirectory({ force });
  return force ? result.freshStudents : result.students;
}

async function findLiveStudent(rollNumber, { force = false } = {}) {
  const normalizedRoll = String(rollNumber || '').trim().toUpperCase();
  let result = await refreshStudentDirectory({ force });
  let student = (force ? result.freshStudents : result.students).find(item => item.rollNumber === normalizedRoll);
  if (!student && !force) {
    result = await refreshStudentDirectory({ force: true });
    student = result.freshStudents.find(item => item.rollNumber === normalizedRoll);
  }
  return { student, result };
}

function publicSettings(settings) {
  return settings || {
    isPublished: false, isCardVisible: false, cardTitle: '', cardDescription: '',
    collegeName: 'Kamaraj College', portalTitle: 'Student Campus Portal', academicYear: '2026-2027'
  };
}

const DEFAULT_BCA_TIMETABLE = {
  Monday: [['DSA', 'Sharumathi'], ['DSA', 'Sharumathi'], ['Aptitude', 'Santhiya'], ['English', 'Venkatesh'], ['Data Visualisation', 'Aparna'], ['Tamil', '']],
  Tuesday: [['BDA', 'DS 1'], ['BDA', 'DS 1'], ['DSA', 'Sharumathi'], ['English', 'Venkatesh'], ['DBMS Lab', 'Aparna'], ['DBMS Lab', 'Aparna']],
  Wednesday: [['DSA', 'Sharumathi'], ['DSA', 'Sharumathi'], ['Data Visualisation', 'Aparna'], ['BDA', 'DS 1'], ['English', 'Venkatesh'], ['English', 'Venkatesh']],
  Thursday: [['BDA', 'DS 1'], ['BDA', 'DS 1'], ['DSA', 'Sharumathi'], ['Aptitude', 'Santhiya'], ['DBMS Lab', 'Aparna'], ['English', 'Venkatesh']],
  Friday: [['Data Visualisation', 'Aparna'], ['English', 'Venkatesh'], ['DSA', 'Sharumathi'], ['DSA', 'Sharumathi'], ['Tamil', ''], ['English', 'Venkatesh']]
};

function defaultSchedule() {
  return Object.entries(DEFAULT_BCA_TIMETABLE).map(([day, periods]) => ({
    day,
    periods: periods.map(([subject, faculty]) => ({ subject, faculty }))
  }));
}

async function ensureDefaultTimetable() {
  const students = await getStudentDirectory();
  const target = students.find(student => (
    /^2nd\s+BCA[\s·-]*A$/i.test(student.className) ||
    /BCA.*(?:2nd|year\s*2|II).*(?:section\s*)?A/i.test(student.className)
  ));
  if (!target) return;
  if (await Timetable.exists({ className: target.className })) return;
  await Timetable.findOneAndUpdate(
    { className: target.className },
    { $setOnInsert: { className: target.className, department: target.department || target.sheetTitle || 'BCA', sheetTitle: target.sheetTitle || target.department || 'BCA', schedule: defaultSchedule() } },
    { upsert: true, new: true }
  );
}

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  service: 'college-portal',
  release: RELEASE,
  configuredClassSheets: DEFAULT_STUDENT_SOURCES.length
}));

app.post('/api/admin/login', (req, res) => {
  const adminUser = process.env.ADMIN_USER || 'kcfpcportal';
  const adminPass = process.env.ADMIN_PASS || 'kcfpcofficial@69';
  if (req.body.username !== adminUser || req.body.password !== adminPass) {
    return res.status(401).json({ message: 'Invalid administrator credentials.' });
  }
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
});

app.get('/api/portal/public', async (_req, res) => {
  try {
    const [settings, announcements] = await Promise.all([
      Settings.findOne({ settingsId: 'master_config' }).lean(),
      Announcement.find({ published: true, publishAt: { $lte: new Date() }, $and: [{ $or: [{ targetClasses: { $exists: false } }, { targetClasses: { $size: 0 } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }] }).sort({ publishAt: -1 }).limit(8).lean()
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
    const rollNumber = String(req.body.rollNumber || '').trim().toUpperCase();
    const dob = normalizeDob(req.body.dob);
    const { student, result } = await findLiveStudent(rollNumber, { force: true });
    if (!student && result.failed) {
      return res.status(503).json({ message: 'The live student spreadsheets could not all be read. Please try again shortly.' });
    }
    if (student && student.dob !== dob) return res.status(401).json({ message: 'Roll number or date of birth is incorrect.' });
    if (!student) return res.status(401).json({ message: 'Roll number or date of birth is incorrect.' });
    const hasVoted = Boolean(await VoteReceipt.exists({ rollNumber }));
    res.json({
      token: jwt.sign({ role: 'student', rollNumber }, JWT_SECRET, { expiresIn: '30d' }),
      student: { name: student.name, rollNumber, className: student.className, department: student.department, year: student.year, section: student.section, hasVoted }
    });
  } catch (error) { res.status(500).json({ message: 'Unable to verify the student directory.', detail: error.message }); }
});

app.get('/api/student/me', verifyStudent, async (req, res) => {
  const { student } = await findLiveStudent(req.user.rollNumber);
  if (!student) return res.status(404).json({ message: 'Student record is no longer active.' });
  const hasVoted = Boolean(await VoteReceipt.exists({ rollNumber: req.user.rollNumber }));
  res.json({ ...studentView(student), hasVoted });
});

app.get('/api/student/announcements', verifyStudent, async (req, res) => {
  const now = new Date();
  const { student } = await findLiveStudent(req.user.rollNumber);
  const className = student?.className || '';
  res.json(await Announcement.find({
    published: true,
    audience: { $in: ['ALL', 'STUDENTS'] },
    publishAt: { $lte: now },
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: [{ targetClasses: { $exists: false } }, { targetClasses: { $size: 0 } }, { targetClasses: className }] }
    ]
  }).sort({ publishAt: -1 }));
});

app.get('/api/student/push/public-key', verifyStudent, async (_req, res) => {
  try {
    const config = await getWebPushConfig();
    res.json({ publicKey: config.publicKey });
  } catch (error) { res.status(500).json({ message: 'Notifications are temporarily unavailable.' }); }
});

app.post('/api/student/push/subscriptions', verifyStudent, async (req, res) => {
  try {
    const subscription = req.body.subscription || req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ message: 'The notification subscription is incomplete.' });
    }
    const endpoint = new URL(subscription.endpoint);
    if (endpoint.protocol !== 'https:') return res.status(400).json({ message: 'The notification endpoint must be secure.' });
    const { student } = await findLiveStudent(req.user.rollNumber);
    if (!student) return res.status(404).json({ message: 'Student record is no longer active.' });
    await PushSubscription.findOneAndUpdate(
      { endpoint: endpoint.toString() },
      {
        endpoint: endpoint.toString(),
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        rollNumber: student.rollNumber,
        className: student.className,
        active: true
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ message: 'Announcement notifications are enabled.' });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.delete('/api/student/push/subscriptions', verifyStudent, async (req, res) => {
  const endpoint = String(req.body.endpoint || '').trim();
  if (endpoint) await PushSubscription.deleteOne({ endpoint, rollNumber: req.user.rollNumber });
  res.json({ message: 'Announcement notifications are disabled.' });
});

app.get('/api/student/timetable', verifyStudent, async (req, res) => {
  const { student } = await findLiveStudent(req.user.rollNumber);
  if (!student) return res.status(404).json({ message: 'Student record is no longer active.' });
  await ensureDefaultTimetable();
  const timetable = await Timetable.findOne({ className: student.className }).lean();
  res.json({
    className: student.className,
    department: student.department || '',
    timetable: timetable || null
  });
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
    const { student, result } = await findLiveStudent(rollNumber, { force: true });
    if (!student) {
      const status = result.failed ? 503 : 403;
      return res.status(status).json({ message: result.failed ? 'The live student register is temporarily unavailable.' : 'This student is not present in the live register.' });
    }
    if (await VoteReceipt.exists({ rollNumber })) return res.status(409).json({ message: 'Your ballot has already been submitted.' });
    const settings = await Settings.findOne({ settingsId: 'master_config' });
    if (!settings?.isPublished) return res.status(400).json({ message: 'Voting is currently closed.' });
    const candidateIds = [...new Set((req.body.candidateIds || []).map(String))];
    const candidates = await Candidate.find({ _id: { $in: candidateIds } });
    const allPostings = await Candidate.distinct('posting');
    if (candidates.length !== candidateIds.length || new Set(candidates.map(c => c.posting.toUpperCase())).size !== allPostings.length) {
      return res.status(400).json({ message: 'Select exactly one candidate for every position.' });
    }
    await VoteReceipt.create({ rollNumber, name: student.name, candidateIds });
    await Candidate.updateMany({ _id: { $in: candidateIds } }, { $inc: { votes: 1 } });
    res.json({ message: 'Your ballot was submitted successfully.' });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Your ballot has already been submitted.' });
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/stats', verifyAdmin, async (_req, res) => {
  const students = await getStudentDirectory();
  const classes = currentClassDirectory();
  const eligibleRolls = students.map(student => student.rollNumber);
  const [totalVotes, totalCandidates, totalAnnouncements] = await Promise.all([
    VoteReceipt.countDocuments({ rollNumber: { $in: eligibleRolls } }), Candidate.countDocuments(),
    Announcement.countDocuments({ published: true })
  ]);
  res.json({
    totalStudents: students.length,
    totalVotes,
    totalCandidates,
    totalAnnouncements,
    totalClasses: classes.length
  });
});

app.get('/api/admin/students', verifyAdmin, async (req, res) => {
  let students = await getStudentDirectory();
  if (req.query.className) students = students.filter(student => student.className === req.query.className);
  const votedRolls = await VoteReceipt.distinct('rollNumber');
  const voted = new Set(votedRolls);
  res.json(students.map(student => ({ ...studentView(student), hasVoted: voted.has(student.rollNumber) })));
});

app.get('/api/admin/classes', verifyAdmin, async (_req, res) => {
  await getStudentDirectory();
  res.json(currentClassDirectory());
});

function cleanTimetableSchedule(schedule) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const source = Array.isArray(schedule) ? schedule : [];
  return days.map(day => {
    const match = source.find(item => item?.day === day) || {};
    const periods = Array.isArray(match.periods) ? match.periods : [];
    return {
      day,
      periods: Array.from({ length: 6 }, (_, index) => ({
        subject: String(periods[index]?.subject || '').trim().slice(0, 100),
        faculty: String(periods[index]?.faculty || '').trim().slice(0, 100)
      }))
    };
  });
}

app.get('/api/admin/timetables', verifyAdmin, async (_req, res) => {
  await ensureDefaultTimetable();
  res.json(await Timetable.find().sort({ className: 1 }).lean());
});

app.post('/api/admin/timetables', verifyAdmin, async (req, res) => {
  const className = String(req.body.className || '').trim();
  await getStudentDirectory();
  const classRecord = currentClassDirectory().find(item => item.className === className);
  if (!classRecord) return res.status(400).json({ message: 'Choose a class imported from the student spreadsheet.' });
  const timetable = await Timetable.findOneAndUpdate(
    { className },
    {
      className,
      department: classRecord.departments?.[0] || '',
      sheetTitle: classRecord.sheets?.[0] || className,
      schedule: cleanTimetableSchedule(req.body.schedule)
    },
    { upsert: true, new: true, runValidators: true }
  );
  res.json({ message: 'Timetable saved for the selected class.', timetable });
});

app.delete('/api/admin/timetables/:id', verifyAdmin, async (req, res) => {
  const timetable = await Timetable.findByIdAndDelete(req.params.id);
  if (!timetable) return res.status(404).json({ message: 'Timetable not found.' });
  res.json({ message: 'Timetable removed.' });
});

app.get('/api/admin/sources', verifyAdmin, async (_req, res) => {
  await ensureDefaultSources();
  res.json(await StudentSource.find().sort({ createdAt: 1 }));
});

app.post('/api/admin/sources/sync-all', verifyAdmin, async (_req, res) => {
  await refreshStudentDirectory({ force: true });
  const sources = await StudentSource.find({ enabled: true }).sort({ createdAt: 1 }).lean();
  res.json({
    message: 'Live student spreadsheets refreshed.',
    sources: sources.map(source => ({
      name: source.name,
      studentCount: source.studentCount,
      classCount: source.classCount,
      lastSyncAt: source.lastSyncAt,
      lastError: source.lastError
    }))
  });
});

app.post('/api/admin/sources', verifyAdmin, async (req, res) => {
  const sheetId = extractSheetId(req.body.url);
  if (!sheetId) return res.status(400).json({ message: 'Enter a valid Google Sheets link.' });
  try {
    const source = await StudentSource.create({ name: req.body.name || 'Student register', url: req.body.url, sheetId, enabled: true });
    const result = await syncSource(source);
    res.status(201).json({ message: `Connected ${result.imported} live students across ${result.classes.length} classes.`, source });
  } catch (error) { res.status(400).json({ message: `The sheet could not be imported: ${error.message}` }); }
});

app.post('/api/admin/sources/:id/sync', verifyAdmin, async (req, res) => {
  try {
    const source = await StudentSource.findById(req.params.id);
    if (!source) return res.status(404).json({ message: 'Spreadsheet source not found.' });
    const result = await syncSource(source);
    res.json({
      message: `Read ${result.imported} live students across ${result.classes.length} classes.`,
      result: { imported: result.imported, classes: result.classes }
    });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.delete('/api/admin/sources/:id', verifyAdmin, async (req, res) => {
  const source = await StudentSource.findByIdAndDelete(req.params.id);
  if (source) {
    studentDirectoryBySource.delete(source.sheetId);
    classDirectoryBySource.delete(source.sheetId);
  }
  res.json({ message: 'Spreadsheet source was disconnected.' });
});

app.get('/api/admin/announcements', verifyAdmin, async (_req, res) => res.json(await Announcement.find().sort({ createdAt: -1 })));
app.post('/api/admin/announcements', verifyAdmin, upload.single('image'), async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.published = String(req.body.published) !== 'false';
    payload.targetClasses = req.body.targetClasses ? JSON.parse(req.body.targetClasses) : [];
    payload.linkUrl = safeExternalUrl(req.body.linkUrl);
    if (req.file) payload.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const announcement = await Announcement.create(payload);
    notifyAnnouncementIfLive(announcement._id).catch(error => console.error(`Announcement push failed: ${error.message}`));
    res.status(201).json(announcement);
  }
  catch (error) { res.status(400).json({ message: error.message }); }
});
app.put('/api/admin/announcements/:id', verifyAdmin, upload.single('image'), async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.body.published !== undefined) payload.published = String(req.body.published) !== 'false';
    if (req.body.targetClasses) payload.targetClasses = JSON.parse(req.body.targetClasses);
    if (req.body.linkUrl !== undefined) payload.linkUrl = safeExternalUrl(req.body.linkUrl);
    if (req.file) payload.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const announcement = await Announcement.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (announcement) notifyAnnouncementIfLive(announcement._id).catch(error => console.error(`Announcement push failed: ${error.message}`));
    res.json(announcement);
  }
  catch (error) { res.status(400).json({ message: error.message }); }
});
app.delete('/api/admin/announcements/:id', verifyAdmin, async (req, res) => {
  await Announcement.findByIdAndDelete(req.params.id); res.json({ message: 'Announcement deleted.' });
});

app.get('/api/results/final', async (_req, res) => {
  const students = await getStudentDirectory();
  const totalVotes = await VoteReceipt.countDocuments({ rollNumber: { $in: students.map(student => student.rollNumber) } });
  const totalStudents = students.length;
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
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(candidates.map(c => ({ Name: c.name, Position: c.posting, Department: c.department, Year: c.year, Section: c.section, Votes: c.votes }))), 'Election Results');
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
