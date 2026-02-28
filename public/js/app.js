/**
 * IngChat — App core: state, utilities, initialization
 */

window.App = (() => {
  // ── Global State ───────────────────────────────────
  const state = {
    user: null,
    token: null,
    conversations: [],
    activeConvId: null,
    messages: new Map(),       // convId -> message[]
    typingUsers: new Map(),    // convId -> { userId: username }
    onlineUsers: new Set(),
    replyTo: null,             // message being replied to
    pendingFile: null,         // { file, url, type, name, size }
    oldestMsgId: new Map(),    // convId -> oldest message id
    hasMore: new Map(),        // convId -> bool
    isGroup: false,
  };

  // ── Avatar Colors ──────────────────────────────────
  const COLORS = [
    '#e57373','#f06292','#ba68c8','#7986cb','#64b5f6',
    '#4db6ac','#81c784','#dce775','#ffb74d','#ff8a65',
    '#a1887f','#90a4ae'
  ];

  function colorForName(name) {
    let hash = 0;
    for (const c of String(name)) hash = (hash << 5) - hash + c.charCodeAt(0);
    return COLORS[Math.abs(hash) % COLORS.length];
  }

  function avatarHtml(avatar, name, size = 40) {
    const initials = getInitials(name);
    const color = colorForName(name);
    if (avatar) {
      return `<img src="${escHtml(avatar)}" alt="${escHtml(initials)}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';this.nextSibling.style.display='flex'">
              <div class="avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.38)}px;background:${color};display:none">${escHtml(initials)}</div>`;
    }
    return `<div class="avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.38)}px;background:${color}">${escHtml(initials)}</div>`;
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
      : String(name).slice(0,2).toUpperCase();
  }

  // ── Formatting ─────────────────────────────────────
  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
    const now = new Date();
    const diff = now - d;
    const oneDay = 86400000;
    if (diff < oneDay && now.getDate() === d.getDate()) return 'Today';
    if (diff < 2 * oneDay) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
    const now = new Date();
    const diff = now - d;
    const oneDay = 86400000;
    if (diff < oneDay && now.getDate() === d.getDate())
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 7 * oneDay)
      return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
  }

  function formatLastSeen(ts) {
    if (!ts) return 'last seen a long time ago';
    const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'last seen just now';
    if (diff < 3600000) return `last seen ${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000 && now.getDate() === d.getDate())
      return `last seen today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getFileIcon(name, mimetype) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const mime = mimetype || '';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (['pdf'].includes(ext)) return '📄';
    if (['doc','docx'].includes(ext)) return '📝';
    if (['xls','xlsx'].includes(ext)) return '📊';
    if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
    if (['mp4','mkv','avi','mov','webm'].includes(ext)) return '🎬';
    return '📎';
  }

  // ── Toast Notifications ────────────────────────────
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── API Helper ─────────────────────────────────────
  async function api(method, path, body, isFormData = false) {
    const headers = {};
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    if (!isFormData && body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  // ── PWA Install ────────────────────────────────────
  let deferredInstall = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    const btn = document.getElementById('install-btn');
    if (btn) btn.classList.remove('hidden');
  });

  function setupInstallBtn() {
    const btn = document.getElementById('install-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === 'accepted') btn.classList.add('hidden');
      deferredInstall = null;
    });
  }

  // ── Service Worker ─────────────────────────────────
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  }

  // ── App Init ───────────────────────────────────────
  async function init() {
    registerSW();
    setupInstallBtn();

    const savedToken = localStorage.getItem('ingchat_token');
    if (savedToken) {
      state.token = savedToken;
      try {
        const { user } = await api('GET', '/auth/me');
        state.user = user;
        Auth.showApp();
      } catch {
        localStorage.removeItem('ingchat_token');
        state.token = null;
        Auth.showAuthScreen();
      }
    } else {
      Auth.showAuthScreen();
    }
  }

  function setUser(user, token) {
    state.user = user;
    state.token = token;
    localStorage.setItem('ingchat_token', token);
  }

  function logout() {
    state.user = null;
    state.token = null;
    state.conversations = [];
    state.activeConvId = null;
    state.messages.clear();
    state.onlineUsers.clear();
    state.typingUsers.clear();
    localStorage.removeItem('ingchat_token');
    SocketClient.disconnect();
    Auth.showAuthScreen();
  }

  // Public API
  return {
    state,
    init, setUser, logout,
    api, showToast,
    avatarHtml, getInitials, colorForName,
    formatTime, formatDate, formatRelativeTime, formatLastSeen, formatFileSize,
    escHtml, getFileIcon
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
