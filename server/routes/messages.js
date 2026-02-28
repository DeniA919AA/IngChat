const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/files');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    cb(null, `${unique}${ext}`);
  }
});

const fileUpload = multer({
  storage: fileStorage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Get all conversations for current user
router.get('/conversations', authenticateToken, (req, res) => {
  const db = getDb();

  const conversations = db.prepare(`
    SELECT
      c.id, c.type, c.name, c.avatar, c.description,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_type,
      (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
      (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_sender_id,
      (
        SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = c.id
        AND m.sender_id != ?
        AND m.id NOT IN (SELECT mr.message_id FROM message_reads mr WHERE mr.user_id = ?)
      ) as unread_count
    FROM conversations c
    JOIN conversation_members cm ON c.id = cm.conversation_id
    WHERE cm.user_id = ?
    ORDER BY last_message_time DESC
  `).all(req.user.id, req.user.id, req.user.id);

  const enriched = conversations.map(conv => {
    if (conv.type === 'private') {
      const otherUser = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.last_seen
        FROM conversation_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.conversation_id = ? AND cm.user_id != ?
      `).get(conv.id, req.user.id);

      return {
        ...conv,
        name: otherUser?.username || 'Unknown',
        avatar: otherUser?.avatar || null,
        other_user_id: otherUser?.id || null,
        other_user_last_seen: otherUser?.last_seen || null
      };
    }
    return conv;
  });

  res.json({ conversations: enriched });
});

// Get or create a private conversation
router.post('/conversations/private', authenticateToken, (req, res) => {
  const { userId } = req.body;

  if (!userId || Number(userId) === req.user.id) {
    return res.status(400).json({ error: 'Invalid user' });
  }

  const db = getDb();

  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON c.id = cm1.conversation_id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON c.id = cm2.conversation_id AND cm2.user_id = ?
    WHERE c.type = 'private'
  `).get(req.user.id, userId);

  if (existing) return res.json({ conversationId: existing.id });

  const conv = db.prepare("INSERT INTO conversations (type, created_by) VALUES ('private', ?)").run(req.user.id);
  const convId = conv.lastInsertRowid;

  db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(convId, req.user.id);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(convId, userId);

  res.json({ conversationId: convId });
});

// Create group conversation
router.post('/conversations/group', authenticateToken, (req, res) => {
  const { name, memberIds, description } = req.body;

  if (!name || !memberIds || !Array.isArray(memberIds)) {
    return res.status(400).json({ error: 'Name and members are required' });
  }

  const db = getDb();
  const conv = db.prepare(
    "INSERT INTO conversations (type, name, description, created_by) VALUES ('group', ?, ?, ?)"
  ).run(name.trim(), description || '', req.user.id);
  const convId = conv.lastInsertRowid;

  db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'admin')").run(convId, req.user.id);

  for (const memberId of memberIds) {
    if (Number(memberId) !== req.user.id) {
      db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)").run(convId, memberId);
    }
  }

  res.json({ conversationId: convId });
});

// Get conversation info + members
router.get('/conversations/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conv) return res.status(404).json({ error: 'Not found' });

  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.last_seen, cm.role
    FROM conversation_members cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.conversation_id = ?
  `).all(id);

  res.json({ conversation: conv, members });
});

// Get messages in a conversation
router.get('/conversations/:id/messages', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { before, limit = 50 } = req.query;

  const db = getDb();

  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });

  let query = `
    SELECT
      m.id, m.conversation_id, m.sender_id, m.content, m.type,
      m.file_name, m.file_size, m.file_path, m.reply_to, m.created_at,
      u.username as sender_username, u.avatar as sender_avatar,
      rm.content as reply_content, rm.type as reply_type,
      ru.username as reply_username
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    LEFT JOIN messages rm ON m.reply_to = rm.id
    LEFT JOIN users ru ON rm.sender_id = ru.id
    WHERE m.conversation_id = ?
  `;

  const params = [id];

  if (before) {
    query += ' AND m.id < ?';
    params.push(Number(before));
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(Math.min(parseInt(limit), 100));

  const messages = db.prepare(query).all(...params).reverse();

  // Mark unread messages as read
  const unread = messages.filter(m => m.sender_id !== req.user.id);
  if (unread.length > 0) {
    const markRead = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');
    db.transaction(() => {
      for (const msg of unread) markRead.run(msg.id, req.user.id);
    })();
  }

  res.json({ messages, hasMore: messages.length === Math.min(parseInt(limit), 100) });
});

// Upload file/image/voice
router.post('/upload', authenticateToken, fileUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileUrl = `/uploads/files/${req.file.filename}`;

  res.json({
    url: fileUrl,
    name: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// Add member to group
router.post('/conversations/:id/members', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  const db = getDb();

  const myRole = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(id, req.user.id);
  if (!myRole || myRole.role !== 'admin') return res.status(403).json({ error: 'Only admins can add members' });

  const conv = db.prepare("SELECT type FROM conversations WHERE id = ?").get(id);
  if (!conv || conv.type !== 'group') return res.status(400).json({ error: 'Not a group' });

  db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)").run(id, userId);
  res.json({ success: true });
});

module.exports = router;
