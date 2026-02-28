const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// Search users
router.get('/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json({ users: [] });

  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, avatar, last_seen
    FROM users
    WHERE username LIKE ? AND id != ?
    LIMIT 20
  `).all(`%${q}%`, req.user.id);

  res.json({ users });
});

// Get user by id
router.get('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, avatar, bio, last_seen FROM users WHERE id = ?').get(req.params.id);

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Update profile bio
router.put('/profile/bio', authenticateToken, (req, res) => {
  const { bio } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio || '', req.user.id);
  res.json({ success: true });
});

// Upload avatar
router.post('/avatar', authenticateToken, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  const db = getDb();
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.id);
  res.json({ avatar: avatarUrl });
});

module.exports = router;
