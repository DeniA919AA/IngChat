const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');

// Track online users: Map<userId, Set<socketId>>
const onlineUsers = new Map();

function setupSocketHandlers(io) {
  // Auth middleware for socket
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const db = getDb();
      const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(decoded.userId);
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const db = getDb();

    console.log(`[Socket] ${socket.user.username} connected (${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

    // Join all user's conversation rooms
    const conversations = db.prepare(
      'SELECT conversation_id FROM conversation_members WHERE user_id = ?'
    ).all(userId);

    for (const { conversation_id } of conversations) {
      socket.join(`conv:${conversation_id}`);
    }

    // Broadcast online status to contacts
    broadcastUserStatus(io, db, userId, true);

    // ─── Send Message ───────────────────────────────────────────────
    socket.on('send_message', (data, callback) => {
      try {
        const { conversationId, content, type = 'text', filePath, fileName, fileSize, replyTo } = data;

        const member = db.prepare(
          'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
        ).get(conversationId, userId);

        if (!member) return callback?.({ error: 'Not a member of this conversation' });

        const result = db.prepare(`
          INSERT INTO messages (conversation_id, sender_id, content, type, file_path, file_name, file_size, reply_to)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          conversationId, userId,
          content || null, type,
          filePath || null, fileName || null, fileSize || null,
          replyTo || null
        );

        const messageId = result.lastInsertRowid;

        // Mark as read by sender
        db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)').run(messageId, userId);

        const message = db.prepare(`
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
          WHERE m.id = ?
        `).get(messageId);

        io.to(`conv:${conversationId}`).emit('new_message', message);
        callback?.({ success: true, message });

      } catch (error) {
        console.error('[Socket] send_message error:', error);
        callback?.({ error: 'Failed to send message' });
      }
    });

    // ─── Typing Indicator ───────────────────────────────────────────
    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conv:${conversationId}`).emit('user_typing', {
        userId,
        username: socket.user.username,
        conversationId,
        isTyping
      });
    });

    // ─── Mark as Read ───────────────────────────────────────────────
    socket.on('mark_read', ({ conversationId, messageIds }) => {
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;

      const markRead = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');
      db.transaction(() => {
        for (const msgId of messageIds) markRead.run(msgId, userId);
      })();

      socket.to(`conv:${conversationId}`).emit('messages_read', {
        userId, conversationId, messageIds
      });
    });

    // ─── Join Conversation Room ────────────────────────────────────
    socket.on('join_conversation', (conversationId) => {
      const member = db.prepare(
        'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);

      if (member) {
        socket.join(`conv:${conversationId}`);
        socket.to(`conv:${conversationId}`).emit('conversation_updated', { conversationId });
      }
    });

    // ─── Get Online Status ─────────────────────────────────────────
    socket.on('get_online_status', (userIds, callback) => {
      const status = {};
      for (const id of userIds) {
        const uid = Number(id);
        status[uid] = onlineUsers.has(uid) && onlineUsers.get(uid).size > 0;
      }
      callback?.(status);
    });

    // ─── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
          broadcastUserStatus(io, db, userId, false);
        }
      }
      console.log(`[Socket] ${socket.user.username} disconnected`);
    });
  });
}

function broadcastUserStatus(io, db, userId, isOnline) {
  const contacts = db.prepare(`
    SELECT DISTINCT cm2.user_id
    FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
    WHERE cm1.user_id = ? AND cm2.user_id != ?
  `).all(userId, userId);

  const { last_seen } = db.prepare('SELECT last_seen FROM users WHERE id = ?').get(userId) || {};

  for (const { user_id } of contacts) {
    const sockets = onlineUsers.get(user_id);
    if (sockets?.size > 0) {
      for (const socketId of sockets) {
        io.to(socketId).emit('user_status', { userId, isOnline, lastSeen: last_seen });
      }
    }
  }
}

module.exports = { setupSocketHandlers };
