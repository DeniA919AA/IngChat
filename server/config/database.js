const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/ingchat.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      bio TEXT DEFAULT '',
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('private', 'group')),
      name TEXT,
      avatar TEXT,
      description TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'member' CHECK(role IN ('admin', 'member')),
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id),
      content TEXT,
      type TEXT DEFAULT 'text' CHECK(type IN ('text', 'image', 'file', 'voice')),
      file_name TEXT,
      file_size INTEGER,
      file_path TEXT,
      reply_to INTEGER REFERENCES messages(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_members_conv ON conversation_members(conversation_id);
  `);

  console.log('Database initialized successfully');
}

module.exports = { getDb, initializeDatabase };
