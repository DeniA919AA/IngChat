/**
 * IngChat — Чат: переписки, сообщения, отправка, получение
 */

window.Chat = (() => {
  let typingTimeout  = null;
  let isLoadingMore  = false;

  function init() {
    loadConversations();
    bindEvents();
  }

  // ─────────────────────────────────────────────────
  // Список переписок
  // ─────────────────────────────────────────────────
  async function loadConversations() {
    try {
      const { conversations } = await App.api('GET', '/messages/conversations');
      App.state.conversations = conversations;
      renderConversationList(conversations);
      const userIds = conversations
        .filter(c => c.type === 'private' && c.other_user_id)
        .map(c => c.other_user_id);
      if (userIds.length) SocketClient.getOnlineStatus(userIds);
    } catch {
      App.showToast('Ошибка загрузки чатов', 'error');
    }
  }

  function renderConversationList(convs, filter = '') {
    const list = document.getElementById('conversations-list');
    const filtered = filter
      ? convs.filter(c => c.name?.toLowerCase().includes(filter.toLowerCase()))
      : convs;

    if (!filtered.length) {
      list.innerHTML = `<div class="conv-item-placeholder">
        ${filter ? 'Чаты не найдены' : 'Чатов пока нет.<br>Начните новый чат!'}
      </div>`;
      return;
    }

    list.innerHTML = filtered.map(conv => renderConvItem(conv)).join('');
    list.querySelectorAll('.conv-item').forEach(el => {
      el.addEventListener('click', () => openConversation(Number(el.dataset.id)));
    });
  }

  function renderConvItem(conv) {
    const isOnline = conv.type === 'private' && conv.other_user_id &&
                     App.state.onlineUsers.has(conv.other_user_id);
    const isActive = conv.id === App.state.activeConvId;

    let lastMsg = '';
    if      (conv.last_message_type === 'image') lastMsg = '📷 Фото';
    else if (conv.last_message_type === 'voice') lastMsg = '🎤 Голосовое';
    else if (conv.last_message_type === 'file')  lastMsg = '📎 ' + (conv.last_message || 'Файл');
    else lastMsg = App.escHtml(conv.last_message || '');

    if (conv.last_sender_id === App.state.user?.id && conv.last_message) {
      lastMsg = `<span style="color:var(--text-3)">Вы: </span>${lastMsg}`;
    }

    const unread = conv.unread_count > 0;

    return `
    <div class="conv-item${isActive ? ' active' : ''}" data-id="${conv.id}">
      <div class="conv-avatar">
        ${App.avatarHtml(conv.avatar, conv.name, 49)}
        ${isOnline ? '<div class="online-dot"></div>' : ''}
      </div>
      <div class="conv-info">
        <div class="conv-top">
          <div class="conv-name">${App.escHtml(conv.name || 'Чат')}</div>
          <div class="conv-time${unread ? ' unread' : ''}">${conv.last_message_time ? App.formatRelativeTime(conv.last_message_time) : ''}</div>
        </div>
        <div class="conv-bottom">
          <div class="conv-last-msg">${lastMsg}</div>
          ${unread ? `<div class="unread-badge">${conv.unread_count > 99 ? '99+' : conv.unread_count}</div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function updateConvItemInList(convId) {
    const conv = App.state.conversations.find(c => c.id === convId);
    if (!conv) return;
    const el = document.querySelector(`.conv-item[data-id="${convId}"]`);
    if (el) {
      el.outerHTML = renderConvItem(conv);
      document.querySelector(`.conv-item[data-id="${convId}"]`)
        ?.addEventListener('click', () => openConversation(convId));
    }
  }

  // ─────────────────────────────────────────────────
  // Открытие переписки
  // ─────────────────────────────────────────────────
  async function openConversation(convId) {
    App.state.activeConvId = convId;
    document.querySelectorAll('.conv-item').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.id) === convId);
    });

    const conv = App.state.conversations.find(c => c.id === convId);

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.querySelector('.sidebar').classList.add('hidden-mobile');

    updateChatHeader(conv);

    App.state.oldestMsgId.delete(convId);
    App.state.hasMore.delete(convId);

    document.getElementById('messages-list').innerHTML =
      `<div style="display:flex;justify-content:center;padding:20px"><div class="spinner"></div></div>`;

    document.getElementById('chat-view').classList.toggle('group-chat', conv?.type === 'group');

    await loadMessages(convId);

    if (conv?.type === 'private' && conv.other_user_id) {
      SocketClient.getOnlineStatus([conv.other_user_id], status => {
        const online = status[conv.other_user_id];
        if (online) App.state.onlineUsers.add(conv.other_user_id);
        else        App.state.onlineUsers.delete(conv.other_user_id);
        updateChatHeader(conv);
      });
    }

    const c = App.state.conversations.find(x => x.id === convId);
    if (c) { c.unread_count = 0; updateConvItemInList(convId); }
  }

  function updateChatHeader(conv) {
    if (!conv) return;
    const isOnline = conv.type === 'private' && conv.other_user_id &&
                     App.state.onlineUsers.has(conv.other_user_id);

    document.getElementById('chat-header-avatar').innerHTML = App.avatarHtml(conv.avatar, conv.name, 40);
    document.getElementById('chat-name').textContent = conv.name || 'Чат';

    const subtitle = document.getElementById('chat-subtitle');
    if (conv.type === 'private') {
      subtitle.style.color = isOnline ? 'var(--accent)' : 'var(--text-2)';
      subtitle.textContent  = isOnline ? 'в сети' : App.formatLastSeen(conv.other_user_last_seen);
    } else {
      subtitle.style.color = 'var(--text-2)';
      subtitle.textContent = 'нажмите для информации';
    }
  }

  // ─────────────────────────────────────────────────
  // Загрузка сообщений
  // ─────────────────────────────────────────────────
  async function loadMessages(convId, loadMore = false) {
    try {
      const before = loadMore ? App.state.oldestMsgId.get(convId) : undefined;
      const { messages, hasMore } = await App.api(
        'GET', `/messages/conversations/${convId}/messages?limit=50${before ? `&before=${before}` : ''}`
      );

      App.state.hasMore.set(convId, hasMore);
      if (messages.length) {
        App.state.oldestMsgId.set(convId, messages[0].id);
        const stored = App.state.messages.get(convId) || [];
        App.state.messages.set(convId, loadMore ? [...messages, ...stored] : messages);
      }

      if (loadMore) prependMessages(convId, messages);
      else { renderMessages(convId); scrollToBottom(true); }

      document.getElementById('load-more-btn').classList.toggle('hidden', !hasMore);

      const unreadIds = messages.filter(m => m.sender_id !== App.state.user.id).map(m => m.id);
      if (unreadIds.length) SocketClient.markRead(convId, unreadIds);

    } catch {
      App.showToast('Ошибка загрузки сообщений', 'error');
    }
  }

  function renderMessages(convId) {
    const messages = App.state.messages.get(convId) || [];
    const list = document.getElementById('messages-list');
    list.innerHTML = '';
    let lastDate = null;
    for (const msg of messages) {
      const msgDate = App.formatDate(msg.created_at);
      if (msgDate !== lastDate) {
        list.insertAdjacentHTML('beforeend', `<div class="date-divider"><span>${App.escHtml(msgDate)}</span></div>`);
        lastDate = msgDate;
      }
      list.insertAdjacentHTML('beforeend', renderMessage(msg, convId));
    }
    bindMessageEvents(list);
  }

  function prependMessages(convId, messages) {
    const list = document.getElementById('messages-list');
    const scrollBottom = list.scrollHeight - list.parentElement.scrollTop;
    const temp = document.createElement('div');
    let lastDate = null;
    for (const msg of messages) {
      const msgDate = App.formatDate(msg.created_at);
      if (msgDate !== lastDate) {
        temp.insertAdjacentHTML('beforeend', `<div class="date-divider"><span>${App.escHtml(msgDate)}</span></div>`);
        lastDate = msgDate;
      }
      temp.insertAdjacentHTML('beforeend', renderMessage(msg, convId));
    }
    const frag = document.createDocumentFragment();
    while (temp.firstChild) frag.appendChild(temp.firstChild);
    list.prepend(frag);
    bindMessageEvents(list);
    document.getElementById('messages-container').scrollTop = list.scrollHeight - scrollBottom;
  }

  function renderMessage(msg, convId) {
    const isSent = msg.sender_id === App.state.user.id;
    const cls    = isSent ? 'sent' : 'received';

    let contentHtml = '';

    if (msg.reply_to) {
      const rType = msg.reply_type || 'text';
      const rText = rType === 'image' ? '📷 Фото'
                  : rType === 'file'  ? '📎 Файл'
                  : rType === 'voice' ? '🎤 Голосовое'
                  : App.escHtml(msg.reply_content || '');
      contentHtml += `
        <div class="reply-preview-bubble" data-reply-id="${msg.reply_to}">
          <div class="reply-author">${App.escHtml(msg.reply_username || 'Неизвестно')}</div>
          <div class="reply-text">${rText}</div>
        </div>`;
    }

    if (msg.type === 'image') {
      contentHtml += `
        <div class="msg-image" data-src="${App.escHtml(msg.file_path)}" data-name="${App.escHtml(msg.file_name || 'image')}">
          <img src="${App.escHtml(msg.file_path)}" alt="${App.escHtml(msg.file_name || 'Фото')}" loading="lazy">
        </div>`;
    } else if (msg.type === 'voice') {
      contentHtml += `
        <div class="msg-voice">
          <div class="voice-play-btn">${Media.SVG_PLAY}</div>
          <div class="voice-waveform">${Media.createWaveformBars(28)}</div>
          <div class="voice-duration">0:00</div>
          <audio src="${App.escHtml(msg.file_path)}" preload="metadata" style="display:none"></audio>
        </div>`;
    } else if (msg.type === 'file') {
      contentHtml += `
        <div class="msg-file" data-url="${App.escHtml(msg.file_path)}" data-name="${App.escHtml(msg.file_name || 'file')}">
          <div class="msg-file-icon">${App.getFileIcon(msg.file_name, '')}</div>
          <div class="msg-file-info">
            <div class="msg-file-name">${App.escHtml(msg.file_name || 'Файл')}</div>
            <div class="msg-file-size">${App.formatFileSize(msg.file_size)} · нажмите для скачивания</div>
          </div>
        </div>`;
    } else {
      contentHtml += `<div class="msg-text">${linkify(App.escHtml(msg.content || ''))}</div>`;
    }

    const statusHtml   = isSent ? `<span class="msg-status sent-2">✓✓</span>` : '';
    const senderName   = !isSent
      ? `<div class="msg-sender-name" style="color:${App.colorForName(msg.sender_username)}">${App.escHtml(msg.sender_username)}</div>`
      : '';
    const avatarHtml   = !isSent
      ? `<div class="msg-avatar">${App.avatarHtml(msg.sender_avatar, msg.sender_username, 28)}</div>`
      : '';

    return `
      <div class="message ${cls}" data-id="${msg.id}" data-sender="${msg.sender_id}" data-conv="${convId}">
        ${avatarHtml}
        <div class="msg-bubble">
          ${senderName}
          ${contentHtml}
          <div class="msg-meta">
            <span class="msg-time">${App.formatTime(msg.created_at)}</span>
            ${statusHtml}
          </div>
        </div>
      </div>`;
  }

  function linkify(text) {
    return text.replace(/(https?:\/\/[^\s<>"]+)/g, url =>
      `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
    );
  }

  function bindMessageEvents(list) {
    list.querySelectorAll('.msg-image').forEach(el => {
      el.addEventListener('click', () => Media.openImageViewer(el.dataset.src, el.dataset.name));
    });
    list.querySelectorAll('.msg-file').forEach(el => {
      el.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = el.dataset.url; a.download = el.dataset.name; a.click();
      });
    });
    list.querySelectorAll('.msg-voice').forEach(el => {
      Media.bindVoicePlayer(el, el.querySelector('audio').src);
    });
    list.querySelectorAll('.reply-preview-bubble').forEach(el => {
      el.addEventListener('click', () => {
        const target = list.querySelector(`.message[data-id="${el.dataset.replyId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.background = 'rgba(0,168,132,0.15)';
          setTimeout(() => target.style.background = '', 1500);
        }
      });
    });
    list.querySelectorAll('.msg-bubble').forEach(el => {
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        const msgEl = el.closest('.message');
        if (msgEl) setReplyTo(Number(msgEl.dataset.id));
      });
    });
  }

  // ─────────────────────────────────────────────────
  // Отправка сообщения
  // ─────────────────────────────────────────────────
  function sendMessage() {
    const convId  = App.state.activeConvId;
    if (!convId) return;
    const input   = document.getElementById('message-input');
    const text    = input.value.trim();
    const pending = App.state.pendingFile;
    if (!text && !pending) return;

    if (pending) {
      SocketClient.sendMessage({
        conversationId: convId, content: text || null,
        type: pending.type, filePath: pending.url,
        fileName: pending.name, fileSize: pending.size,
        replyTo: App.state.replyTo
      });
      Media.clearPendingFile();
    } else {
      SocketClient.sendMessage({ conversationId: convId, content: text, type: 'text', replyTo: App.state.replyTo });
    }

    input.value = '';
    input.style.height = 'auto';
    toggleSendVoice();
    clearReply();
    SocketClient.setTyping(convId, false);
    clearTimeout(typingTimeout);
  }

  function sendVoiceMessage(uploadResult) {
    const convId = App.state.activeConvId;
    if (!convId) return;
    SocketClient.sendMessage({
      conversationId: convId, content: null, type: 'voice',
      filePath: uploadResult.url, fileName: uploadResult.name, fileSize: uploadResult.size
    });
  }

  // ─────────────────────────────────────────────────
  // Входящие сокет-события
  // ─────────────────────────────────────────────────
  function handleIncomingMessage(msg) {
    const convId = msg.conversation_id;
    const stored = App.state.messages.get(convId) || [];
    stored.push(msg);
    App.state.messages.set(convId, stored);

    if (convId === App.state.activeConvId) {
      const list       = document.getElementById('messages-list');
      const isAtBottom = isScrolledToBottom();
      const lastDate   = stored.length >= 2 ? App.formatDate(stored[stored.length-2]?.created_at) : null;
      const newDate    = App.formatDate(msg.created_at);
      if (lastDate !== newDate)
        list.insertAdjacentHTML('beforeend', `<div class="date-divider"><span>${App.escHtml(newDate)}</span></div>`);
      list.insertAdjacentHTML('beforeend', renderMessage(msg, convId));
      bindMessageEvents(list);
      if (isAtBottom) scrollToBottom(true);
      if (msg.sender_id !== App.state.user.id) SocketClient.markRead(convId, [msg.id]);
    } else {
      const conv = App.state.conversations.find(c => c.id === convId);
      if (conv) {
        conv.unread_count = (conv.unread_count || 0) + 1;
        const preview = msg.type === 'text' ? msg.content : msg.type === 'image' ? '📷 Фото' : msg.type === 'voice' ? '🎤 Голосовое' : '📎 Файл';
        App.showToast(`${conv.name}: ${preview}`, 'info', 3000);
      }
    }

    const conv = App.state.conversations.find(c => c.id === convId);
    if (conv) {
      conv.last_message      = msg.content || msg.file_name || '';
      conv.last_message_type = msg.type;
      conv.last_message_time = msg.created_at;
      conv.last_sender_id    = msg.sender_id;
      App.state.conversations = [conv, ...App.state.conversations.filter(c => c.id !== convId)];
      renderConversationList(App.state.conversations);
    } else {
      loadConversations().then(() => {
        if (msg.conversation_id) SocketClient.joinConversation(msg.conversation_id);
      });
    }
  }

  function handleTyping(userId, username, conversationId, isTyping) {
    if (conversationId !== App.state.activeConvId) return;
    const map = App.state.typingUsers.get(conversationId) || {};
    if (isTyping) map[userId] = username; else delete map[userId];
    App.state.typingUsers.set(conversationId, map);
    const typers    = Object.values(map);
    const indicator = document.getElementById('typing-indicator');
    if (typers.length) {
      const names = typers.slice(0,2).join(', ');
      const verb  = typers.length === 1 ? 'печатает' : 'печатают';
      indicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>
        <span>${App.escHtml(names)} ${verb}</span>`;
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
      indicator.innerHTML = '';
    }
  }

  function handleMessagesRead(userId, conversationId, messageIds) {
    if (conversationId !== App.state.activeConvId) return;
    messageIds.forEach(id => {
      const el = document.querySelector(`.message[data-id="${id}"] .msg-status`);
      if (el) { el.textContent = '✓✓'; el.className = 'msg-status read'; }
    });
  }

  function handleUserStatus(userId, isOnline, lastSeen) {
    if (isOnline) App.state.onlineUsers.add(userId);
    else          App.state.onlineUsers.delete(userId);
    const conv = App.state.conversations.find(c => c.other_user_id === userId);
    if (conv) {
      conv.other_user_last_seen = lastSeen;
      updateConvItemInList(conv.id);
      if (conv.id === App.state.activeConvId) updateChatHeader(conv);
    }
  }

  // ─────────────────────────────────────────────────
  // Ответ на сообщение
  // ─────────────────────────────────────────────────
  function setReplyTo(msgId) {
    const msg = (App.state.messages.get(App.state.activeConvId) || []).find(m => m.id === msgId);
    if (!msg) return;
    App.state.replyTo = msgId;
    const bar = document.getElementById('reply-bar');
    bar.querySelector('.reply-bar-author').textContent = msg.sender_username;
    bar.querySelector('.reply-bar-text').textContent =
      msg.type === 'image' ? '📷 Фото' :
      msg.type === 'file'  ? '📎 Файл' :
      msg.type === 'voice' ? '🎤 Голосовое' : (msg.content || '');
    bar.classList.remove('hidden');
    document.getElementById('message-input').focus();
  }

  function clearReply() {
    App.state.replyTo = null;
    document.getElementById('reply-bar').classList.add('hidden');
  }

  // ─────────────────────────────────────────────────
  // Новый чат / группа
  // ─────────────────────────────────────────────────
  async function startPrivateChat(userId) {
    try {
      const { conversationId } = await App.api('POST', '/messages/conversations/private', { userId });
      SocketClient.joinConversation(conversationId);
      await loadConversations();
      openConversation(conversationId);
      Auth.closeModal();
    } catch (err) { App.showToast(err.message, 'error'); }
  }

  async function createGroup(name, description, memberIds) {
    try {
      const { conversationId } = await App.api('POST', '/messages/conversations/group', { name, description, memberIds });
      SocketClient.joinConversation(conversationId);
      await loadConversations();
      openConversation(conversationId);
      Auth.closeModal();
    } catch (err) { App.showToast(err.message, 'error'); }
  }

  // ─────────────────────────────────────────────────
  // Скролл
  // ─────────────────────────────────────────────────
  function scrollToBottom(smooth = false) {
    const c = document.getElementById('messages-container');
    c.scrollTo({ top: c.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function isScrolledToBottom() {
    const c = document.getElementById('messages-container');
    return c.scrollHeight - c.scrollTop - c.clientHeight < 100;
  }

  function toggleSendVoice() {
    const hasContent = document.getElementById('message-input').value.trim().length > 0 || !!App.state.pendingFile;
    document.getElementById('send-btn').classList.toggle('hidden', !hasContent);
    document.getElementById('voice-btn').classList.toggle('hidden', hasContent);
  }

  // ─────────────────────────────────────────────────
  // Обработчики событий
  // ─────────────────────────────────────────────────
  function bindEvents() {
    const input = document.getElementById('message-input');

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      toggleSendVoice();
      if (App.state.activeConvId) {
        SocketClient.setTyping(App.state.activeConvId, true);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => SocketClient.setTyping(App.state.activeConvId, false), 2000);
      }
    });

    document.getElementById('send-btn').addEventListener('click', sendMessage);

    document.getElementById('back-btn').addEventListener('click', () => {
      App.state.activeConvId = null;
      document.getElementById('chat-view').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      document.querySelector('.sidebar').classList.remove('hidden-mobile');
    });

    document.getElementById('search-input').addEventListener('input', e => {
      renderConversationList(App.state.conversations, e.target.value);
    });

    document.getElementById('messages-container').addEventListener('scroll', e => {
      if (e.target.scrollTop < 60 && !isLoadingMore) {
        const convId = App.state.activeConvId;
        if (convId && App.state.hasMore.get(convId)) {
          isLoadingMore = true;
          loadMessages(convId, true).finally(() => { isLoadingMore = false; });
        }
      }
    });

    document.getElementById('load-more-btn').addEventListener('click', () => {
      const convId = App.state.activeConvId;
      if (convId && !isLoadingMore) {
        isLoadingMore = true;
        loadMessages(convId, true).finally(() => { isLoadingMore = false; });
      }
    });

    document.getElementById('new-chat-btn').addEventListener('click', openNewChatModal);
    document.getElementById('new-group-btn').addEventListener('click', openNewGroupModal);
    document.getElementById('chat-info-btn').addEventListener('click', openChatInfo);
    document.getElementById('chat-header-info').addEventListener('click', openChatInfo);

    document.getElementById('attach-btn').addEventListener('click', e => {
      e.stopPropagation(); toggleAttachMenu();
    });
    document.getElementById('attach-image').addEventListener('click', () => {
      document.getElementById('image-input').click(); closeAttachMenu();
    });
    document.getElementById('attach-file').addEventListener('click', () => {
      document.getElementById('file-input').click(); closeAttachMenu();
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#attach-btn') && !e.target.closest('#attach-menu')) closeAttachMenu();
    });

    document.getElementById('reply-bar-close').addEventListener('click', clearReply);
  }

  function toggleAttachMenu() { document.getElementById('attach-menu').classList.toggle('hidden'); }
  function closeAttachMenu()  { document.getElementById('attach-menu').classList.add('hidden'); }

  // ─────────────────────────────────────────────────
  // Модал: Новый чат
  // ─────────────────────────────────────────────────
  function openNewChatModal() {
    Auth.openModal('new-chat-modal');
    const searchEl = document.getElementById('new-chat-search');
    const results  = document.getElementById('new-chat-results');
    searchEl.value = '';
    results.innerHTML = '<div class="search-empty">Найдите пользователей по имени</div>';
    searchEl.focus();

    let debounce;
    searchEl.oninput = () => {
      clearTimeout(debounce);
      const q = searchEl.value.trim();
      if (!q) { results.innerHTML = '<div class="search-empty">Найдите пользователей по имени</div>'; return; }
      debounce = setTimeout(async () => {
        try {
          const { users } = await App.api('GET', `/users/search?q=${encodeURIComponent(q)}`);
          if (!users.length) { results.innerHTML = '<div class="search-empty">Пользователи не найдены</div>'; return; }
          results.innerHTML = users.map(u => `
            <div class="user-item" data-id="${u.id}">
              <div class="user-item-avatar">${App.avatarHtml(u.avatar, u.username, 44)}</div>
              <div class="user-item-info">
                <div class="user-item-name">${App.escHtml(u.username)}</div>
                <div class="user-item-sub">${App.state.onlineUsers.has(u.id) ? '🟢 В сети' : App.formatLastSeen(u.last_seen)}</div>
              </div>
            </div>`).join('');
          results.querySelectorAll('.user-item').forEach(el => {
            el.addEventListener('click', () => startPrivateChat(Number(el.dataset.id)));
          });
        } catch { results.innerHTML = '<div class="search-empty">Ошибка поиска</div>'; }
      }, 300);
    };
  }

  // ─────────────────────────────────────────────────
  // Модал: Новая группа
  // ─────────────────────────────────────────────────
  let selectedMembers = new Map();

  function openNewGroupModal() {
    selectedMembers.clear();
    Auth.openModal('new-group-modal');
    ['group-name-input','group-desc-input','group-search'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('group-search-results').innerHTML = '';
    document.getElementById('group-selected-members').innerHTML = '';
    document.getElementById('create-group-btn').disabled = true;

    const searchEl = document.getElementById('group-search');
    let debounce;
    searchEl.oninput = () => {
      clearTimeout(debounce);
      const q = searchEl.value.trim();
      if (!q) { document.getElementById('group-search-results').innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        try {
          const { users } = await App.api('GET', `/users/search?q=${encodeURIComponent(q)}`);
          renderGroupSearchResults(users);
        } catch {}
      }, 300);
    };

    document.getElementById('group-name-input').addEventListener('input', checkGroupReady);
    document.getElementById('create-group-btn').addEventListener('click', async () => {
      const name = document.getElementById('group-name-input').value.trim();
      const desc = document.getElementById('group-desc-input').value.trim();
      if (!name || selectedMembers.size === 0) return;
      await createGroup(name, desc, [...selectedMembers.keys()]);
    }, { once: true });
  }

  function renderGroupSearchResults(users) {
    const results = document.getElementById('group-search-results');
    results.innerHTML = users.map(u => `
      <div class="user-item" data-id="${u.id}">
        <div class="user-item-avatar">${App.avatarHtml(u.avatar, u.username, 44)}</div>
        <div class="user-item-info"><div class="user-item-name">${App.escHtml(u.username)}</div></div>
        <input type="checkbox" ${selectedMembers.has(u.id) ? 'checked' : ''}>
      </div>`).join('');

    results.querySelectorAll('.user-item').forEach(el => {
      el.addEventListener('click', () => {
        const uid = Number(el.dataset.id);
        const user = users.find(u => u.id === uid);
        const cb   = el.querySelector('input[type="checkbox"]');
        if (selectedMembers.has(uid)) { selectedMembers.delete(uid); cb.checked = false; }
        else                          { selectedMembers.set(uid, user); cb.checked = true; }
        renderSelectedMembers(); checkGroupReady();
      });
    });
  }

  function renderSelectedMembers() {
    const container = document.getElementById('group-selected-members');
    container.innerHTML = [...selectedMembers.values()].map(u => `
      <div class="member-chip" data-id="${u.id}">
        <div class="member-chip-avatar">${App.avatarHtml(u.avatar, u.username, 24)}</div>
        <span>${App.escHtml(u.username)}</span>
        <span class="member-chip-remove">×</span>
      </div>`).join('');
    container.querySelectorAll('.member-chip').forEach(el => {
      el.querySelector('.member-chip-remove').addEventListener('click', () => {
        selectedMembers.delete(Number(el.dataset.id));
        renderSelectedMembers(); checkGroupReady();
      });
    });
  }

  function checkGroupReady() {
    const name = document.getElementById('group-name-input').value.trim();
    document.getElementById('create-group-btn').disabled = !name || selectedMembers.size === 0;
  }

  // ─────────────────────────────────────────────────
  // Информация о чате
  // ─────────────────────────────────────────────────
  async function openChatInfo() {
    const convId = App.state.activeConvId;
    if (!convId) return;
    try {
      const { conversation, members } = await App.api('GET', `/messages/conversations/${convId}`);
      const modal = document.getElementById('chat-info-modal');
      modal.querySelector('.modal-title').textContent =
        conversation.type === 'group' ? 'Информация о группе' : 'Информация о контакте';
      modal.querySelector('#info-avatar').innerHTML = App.avatarHtml(conversation.avatar, conversation.name, 80);
      modal.querySelector('#info-name').textContent = conversation.name;
      modal.querySelector('#info-desc').textContent = conversation.description || '';

      const memberList = modal.querySelector('#info-members');
      if (conversation.type === 'group') {
        memberList.innerHTML = members.map(m => `
          <div class="user-item">
            <div class="user-item-avatar">${App.avatarHtml(m.avatar, m.username, 44)}</div>
            <div class="user-item-info">
              <div class="user-item-name">${App.escHtml(m.username)}</div>
              <div class="user-item-sub">${m.role === 'admin' ? '⭐ Администратор' : 'Участник'}</div>
            </div>
          </div>`).join('');
        memberList.parentElement.classList.remove('hidden');
      } else {
        memberList.parentElement.classList.add('hidden');
      }
      Auth.openModal('chat-info-modal');
    } catch { App.showToast('Ошибка загрузки информации', 'error'); }
  }

  return {
    init, loadConversations, openConversation,
    handleIncomingMessage, handleTyping, handleMessagesRead, handleUserStatus,
    sendMessage, sendVoiceMessage, renderConversationList
  };
})();
