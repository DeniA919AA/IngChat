/**
 * IngChat — Chat: conversations, messages, send, receive
 */

window.Chat = (() => {
  let typingTimeout = null;
  let isLoadingMore = false;

  // ─────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────
  function init() {
    loadConversations();
    bindEvents();
  }

  // ─────────────────────────────────────────────────
  // Conversations List
  // ─────────────────────────────────────────────────
  async function loadConversations() {
    try {
      const { conversations } = await App.api('GET', '/messages/conversations');
      App.state.conversations = conversations;
      renderConversationList(conversations);

      // Sync online status for private chats
      const userIds = conversations
        .filter(c => c.type === 'private' && c.other_user_id)
        .map(c => c.other_user_id);
      if (userIds.length) SocketClient.getOnlineStatus(userIds);
    } catch (err) {
      App.showToast('Failed to load chats', 'error');
    }
  }

  function renderConversationList(convs, filter = '') {
    const list = document.getElementById('conversations-list');
    const filtered = filter
      ? convs.filter(c => c.name?.toLowerCase().includes(filter.toLowerCase()))
      : convs;

    if (!filtered.length) {
      list.innerHTML = `<div class="conv-item-placeholder">
        ${filter ? 'No chats match your search' : 'No conversations yet.<br>Start a new chat!'}
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
    if (conv.last_message_type === 'image') lastMsg = '📷 Photo';
    else if (conv.last_message_type === 'voice') lastMsg = '🎤 Voice message';
    else if (conv.last_message_type === 'file') lastMsg = '📎 ' + (conv.last_message || 'File');
    else lastMsg = App.escHtml(conv.last_message || '');

    if (conv.last_sender_id === App.state.user?.id && conv.last_message) {
      lastMsg = `<span style="color:var(--text-3)">You: </span>${lastMsg}`;
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
          <div class="conv-name">${App.escHtml(conv.name || 'Chat')}</div>
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
  // Open Conversation
  // ─────────────────────────────────────────────────
  async function openConversation(convId) {
    // Update active state
    App.state.activeConvId = convId;
    document.querySelectorAll('.conv-item').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.id) === convId);
    });

    const conv = App.state.conversations.find(c => c.id === convId);

    // Show chat view
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');

    // Mobile: hide sidebar
    document.querySelector('.sidebar').classList.add('hidden-mobile');

    // Update header
    updateChatHeader(conv);

    // Reset and load messages
    App.state.oldestMsgId.delete(convId);
    App.state.hasMore.delete(convId);

    const msgsList = document.getElementById('messages-list');
    msgsList.innerHTML = `<div style="display:flex;justify-content:center;padding:20px"><div class="spinner"></div></div>`;

    // Group chat class
    document.getElementById('chat-view').classList.toggle(
      'group-chat', conv?.type === 'group'
    );

    await loadMessages(convId);

    // Get online status for private chat
    if (conv?.type === 'private' && conv.other_user_id) {
      SocketClient.getOnlineStatus([conv.other_user_id], status => {
        const online = status[conv.other_user_id];
        if (online) App.state.onlineUsers.add(conv.other_user_id);
        else        App.state.onlineUsers.delete(conv.other_user_id);
        updateChatHeader(conv);
      });
    }

    // Clear unread badge in sidebar
    const c = App.state.conversations.find(x => x.id === convId);
    if (c) { c.unread_count = 0; updateConvItemInList(convId); }
  }

  function updateChatHeader(conv) {
    if (!conv) return;
    const isOnline = conv.type === 'private' && conv.other_user_id &&
                     App.state.onlineUsers.has(conv.other_user_id);

    document.getElementById('chat-header-avatar').innerHTML = App.avatarHtml(conv.avatar, conv.name, 40);
    document.getElementById('chat-name').textContent = conv.name || 'Chat';

    const subtitle = document.getElementById('chat-subtitle');
    if (conv.type === 'private') {
      subtitle.style.color = isOnline ? 'var(--accent)' : 'var(--text-2)';
      if (isOnline) subtitle.textContent = 'online';
      else subtitle.textContent = App.formatLastSeen(conv.other_user_last_seen);
    } else {
      subtitle.style.color = 'var(--text-2)';
      subtitle.textContent = 'tap for group info';
    }
  }

  // ─────────────────────────────────────────────────
  // Load Messages
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
        if (loadMore) App.state.messages.set(convId, [...messages, ...stored]);
        else          App.state.messages.set(convId, messages);
      }

      if (loadMore) {
        prependMessages(convId, messages);
      } else {
        renderMessages(convId);
        scrollToBottom(true);
      }

      // Update load more button
      const lmBtn = document.getElementById('load-more-btn');
      lmBtn.classList.toggle('hidden', !hasMore);

      // Mark as read
      const unreadIds = messages.filter(m => m.sender_id !== App.state.user.id).map(m => m.id);
      if (unreadIds.length) SocketClient.markRead(convId, unreadIds);

    } catch (err) {
      App.showToast('Failed to load messages', 'error');
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
    const frag = document.createDocumentFragment();
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

    while (temp.firstChild) frag.appendChild(temp.firstChild);
    list.prepend(frag);
    bindMessageEvents(list);

    // Restore scroll position
    const container = document.getElementById('messages-container');
    container.scrollTop = list.scrollHeight - scrollBottom;
  }

  function renderMessage(msg, convId) {
    const isSent = msg.sender_id === App.state.user.id;
    const cls    = isSent ? 'sent' : 'received';

    let contentHtml = '';

    if (msg.reply_to) {
      const rType = msg.reply_type || 'text';
      const rText = rType === 'image' ? '📷 Photo' : rType === 'file' ? '📎 File' : rType === 'voice' ? '🎤 Voice' : App.escHtml(msg.reply_content || '');
      contentHtml += `
        <div class="reply-preview-bubble" data-reply-id="${msg.reply_to}">
          <div class="reply-author">${App.escHtml(msg.reply_username || 'Unknown')}</div>
          <div class="reply-text">${rText}</div>
        </div>`;
    }

    if (msg.type === 'image') {
      contentHtml += `
        <div class="msg-image" data-src="${App.escHtml(msg.file_path)}" data-name="${App.escHtml(msg.file_name || 'image')}">
          <img src="${App.escHtml(msg.file_path)}" alt="${App.escHtml(msg.file_name || 'Image')}" loading="lazy">
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
            <div class="msg-file-name">${App.escHtml(msg.file_name || 'File')}</div>
            <div class="msg-file-size">${App.formatFileSize(msg.file_size)} · tap to download</div>
          </div>
        </div>`;
    } else {
      contentHtml += `<div class="msg-text">${linkify(App.escHtml(msg.content || ''))}</div>`;
    }

    const statusHtml = isSent ? `<span class="msg-status sent-2">✓✓</span>` : '';

    const senderName = !isSent
      ? `<div class="msg-sender-name" style="color:${App.colorForName(msg.sender_username)}">${App.escHtml(msg.sender_username)}</div>`
      : '';

    const avatarHtml = !isSent
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
    // Images — open viewer
    list.querySelectorAll('.msg-image').forEach(el => {
      el.addEventListener('click', () => {
        Media.openImageViewer(el.dataset.src, el.dataset.name);
      });
    });

    // Files — download
    list.querySelectorAll('.msg-file').forEach(el => {
      el.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = el.dataset.url;
        a.download = el.dataset.name;
        a.click();
      });
    });

    // Voice messages
    list.querySelectorAll('.msg-voice').forEach(el => {
      const src = el.querySelector('audio').src;
      Media.bindVoicePlayer(el, src);
    });

    // Reply preview jump
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

    // Right-click / long-press → reply
    list.querySelectorAll('.msg-bubble').forEach(el => {
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        const msgEl = el.closest('.message');
        if (msgEl) setReplyTo(Number(msgEl.dataset.id));
      });
    });
  }

  // ─────────────────────────────────────────────────
  // Send Message
  // ─────────────────────────────────────────────────
  function sendMessage() {
    const convId = App.state.activeConvId;
    if (!convId) return;

    const input  = document.getElementById('message-input');
    const text   = input.value.trim();
    const pending = App.state.pendingFile;

    if (!text && !pending) return;

    if (pending) {
      SocketClient.sendMessage({
        conversationId: convId,
        content: text || null,
        type: pending.type,
        filePath: pending.url,
        fileName: pending.name,
        fileSize: pending.size,
        replyTo: App.state.replyTo
      });
      Media.clearPendingFile();
    } else {
      SocketClient.sendMessage({
        conversationId: convId,
        content: text,
        type: 'text',
        replyTo: App.state.replyTo
      });
    }

    input.value = '';
    input.style.height = 'auto';
    toggleSendVoice();
    clearReply();

    // Stop typing indicator
    SocketClient.setTyping(convId, false);
    clearTimeout(typingTimeout);
  }

  function sendVoiceMessage(uploadResult) {
    const convId = App.state.activeConvId;
    if (!convId) return;

    SocketClient.sendMessage({
      conversationId: convId,
      content: null,
      type: 'voice',
      filePath: uploadResult.url,
      fileName: uploadResult.name,
      fileSize: uploadResult.size
    });
  }

  // ─────────────────────────────────────────────────
  // Incoming Socket Events
  // ─────────────────────────────────────────────────
  function handleIncomingMessage(msg) {
    const convId = msg.conversation_id;

    // Add to stored messages
    const stored = App.state.messages.get(convId) || [];
    stored.push(msg);
    App.state.messages.set(convId, stored);

    // If this is the active conversation, render
    if (convId === App.state.activeConvId) {
      const list = document.getElementById('messages-list');
      const isAtBottom = isScrolledToBottom();

      // Add date divider if needed
      const lastEl = list.lastElementChild;
      const lastDate = lastEl?.querySelector('.msg-time') ? App.formatDate(stored[stored.length-2]?.created_at) : null;
      const newDate  = App.formatDate(msg.created_at);
      if (lastDate !== newDate) {
        list.insertAdjacentHTML('beforeend', `<div class="date-divider"><span>${App.escHtml(newDate)}</span></div>`);
      }

      list.insertAdjacentHTML('beforeend', renderMessage(msg, convId));
      bindMessageEvents(list);

      if (isAtBottom) scrollToBottom(true);

      // Mark as read
      if (msg.sender_id !== App.state.user.id) {
        SocketClient.markRead(convId, [msg.id]);
      }
    } else {
      // Increment unread badge
      const conv = App.state.conversations.find(c => c.id === convId);
      if (conv) {
        conv.unread_count = (conv.unread_count || 0) + 1;
        App.showToast(`${conv.name}: ${msg.type === 'text' ? msg.content : '📷 Media'}`, 'info', 3000);
      }
    }

    // Update conversation list
    const conv = App.state.conversations.find(c => c.id === convId);
    if (conv) {
      conv.last_message      = msg.content || msg.file_name || '';
      conv.last_message_type = msg.type;
      conv.last_message_time = msg.created_at;
      conv.last_sender_id    = msg.sender_id;

      // Move to top
      App.state.conversations = [conv, ...App.state.conversations.filter(c => c.id !== convId)];
      renderConversationList(App.state.conversations);
    } else {
      // New conversation — reload list
      loadConversations().then(() => {
        if (msg.conversation_id) SocketClient.joinConversation(msg.conversation_id);
      });
    }
  }

  function handleTyping(userId, username, conversationId, isTyping) {
    if (conversationId !== App.state.activeConvId) return;

    const map = App.state.typingUsers.get(conversationId) || {};
    if (isTyping) map[userId] = username;
    else          delete map[userId];
    App.state.typingUsers.set(conversationId, map);

    const typers = Object.values(map);
    const indicator = document.getElementById('typing-indicator');

    if (typers.length) {
      const names = typers.slice(0,2).join(', ');
      indicator.innerHTML = `
        <div class="typing-dots"><span></span><span></span><span></span></div>
        <span>${App.escHtml(names)} ${typers.length === 1 ? 'is' : 'are'} typing</span>`;
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
      indicator.innerHTML = '';
    }
  }

  function handleMessagesRead(userId, conversationId, messageIds) {
    if (conversationId !== App.state.activeConvId) return;
    messageIds.forEach(id => {
      const msgEl = document.querySelector(`.message[data-id="${id}"] .msg-status`);
      if (msgEl) { msgEl.textContent = '✓✓'; msgEl.className = 'msg-status read'; }
    });
  }

  function handleUserStatus(userId, isOnline, lastSeen) {
    if (isOnline) App.state.onlineUsers.add(userId);
    else          App.state.onlineUsers.delete(userId);

    // Update dot in conversation list
    const conv = App.state.conversations.find(c => c.other_user_id === userId);
    if (conv) {
      conv.other_user_last_seen = lastSeen;
      updateConvItemInList(conv.id);
      if (conv.id === App.state.activeConvId) updateChatHeader(conv);
    }
  }

  // ─────────────────────────────────────────────────
  // Reply
  // ─────────────────────────────────────────────────
  function setReplyTo(msgId) {
    const msg = (App.state.messages.get(App.state.activeConvId) || []).find(m => m.id === msgId);
    if (!msg) return;
    App.state.replyTo = msgId;

    const bar = document.getElementById('reply-bar');
    bar.querySelector('.reply-bar-author').textContent = msg.sender_username;
    bar.querySelector('.reply-bar-text').textContent =
      msg.type === 'image' ? '📷 Photo' :
      msg.type === 'file'  ? '📎 File'  :
      msg.type === 'voice' ? '🎤 Voice' : (msg.content || '');
    bar.classList.remove('hidden');
    document.getElementById('message-input').focus();
  }

  function clearReply() {
    App.state.replyTo = null;
    document.getElementById('reply-bar').classList.add('hidden');
  }

  // ─────────────────────────────────────────────────
  // New Chat / Group
  // ─────────────────────────────────────────────────
  async function startPrivateChat(userId) {
    try {
      const { conversationId } = await App.api('POST', '/messages/conversations/private', { userId });
      SocketClient.joinConversation(conversationId);
      await loadConversations();
      openConversation(conversationId);
      Auth.closeModal();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  async function createGroup(name, description, memberIds) {
    try {
      const { conversationId } = await App.api('POST', '/messages/conversations/group', {
        name, description, memberIds
      });
      SocketClient.joinConversation(conversationId);
      await loadConversations();
      openConversation(conversationId);
      Auth.closeModal();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  // ─────────────────────────────────────────────────
  // Scroll Helpers
  // ─────────────────────────────────────────────────
  function scrollToBottom(smooth = false) {
    const container = document.getElementById('messages-container');
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function isScrolledToBottom() {
    const c = document.getElementById('messages-container');
    return c.scrollHeight - c.scrollTop - c.clientHeight < 100;
  }

  // ─────────────────────────────────────────────────
  // UI Helpers
  // ─────────────────────────────────────────────────
  function toggleSendVoice() {
    const text = document.getElementById('message-input').value.trim();
    const hasPending = !!App.state.pendingFile;
    const hasContent = text.length > 0 || hasPending;
    document.getElementById('send-btn').classList.toggle('hidden', !hasContent);
    document.getElementById('voice-btn').classList.toggle('hidden', hasContent);
  }

  // ─────────────────────────────────────────────────
  // Bind Events
  // ─────────────────────────────────────────────────
  function bindEvents() {
    const input = document.getElementById('message-input');

    // Send on Enter (Shift+Enter = newline)
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Auto-resize textarea + toggle send/mic
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      toggleSendVoice();

      // Typing indicator
      if (App.state.activeConvId) {
        SocketClient.setTyping(App.state.activeConvId, true);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => SocketClient.setTyping(App.state.activeConvId, false), 2000);
      }
    });

    // Send button
    document.getElementById('send-btn').addEventListener('click', sendMessage);

    // Back button (mobile)
    document.getElementById('back-btn').addEventListener('click', () => {
      App.state.activeConvId = null;
      document.getElementById('chat-view').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      document.querySelector('.sidebar').classList.remove('hidden-mobile');
    });

    // Search input
    document.getElementById('search-input').addEventListener('input', e => {
      renderConversationList(App.state.conversations, e.target.value);
    });

    // Load more messages on scroll
    document.getElementById('messages-container').addEventListener('scroll', e => {
      if (e.target.scrollTop < 60 && !isLoadingMore) {
        const convId = App.state.activeConvId;
        if (convId && App.state.hasMore.get(convId)) {
          isLoadingMore = true;
          loadMessages(convId, true).finally(() => { isLoadingMore = false; });
        }
      }
    });

    // Load more button
    document.getElementById('load-more-btn').addEventListener('click', () => {
      const convId = App.state.activeConvId;
      if (convId && !isLoadingMore) {
        isLoadingMore = true;
        loadMessages(convId, true).finally(() => { isLoadingMore = false; });
      }
    });

    // New chat button
    document.getElementById('new-chat-btn').addEventListener('click', () => {
      openNewChatModal();
    });

    // New group button
    document.getElementById('new-group-btn').addEventListener('click', () => {
      openNewGroupModal();
    });

    // Chat info (header click)
    document.getElementById('chat-info-btn').addEventListener('click', () => {
      openChatInfo();
    });
    document.getElementById('chat-header-info').addEventListener('click', () => {
      openChatInfo();
    });

    // Attach button
    document.getElementById('attach-btn').addEventListener('click', e => {
      e.stopPropagation();
      toggleAttachMenu();
    });

    document.getElementById('attach-image').addEventListener('click', () => {
      document.getElementById('image-input').click();
      closeAttachMenu();
    });

    document.getElementById('attach-file').addEventListener('click', () => {
      document.getElementById('file-input').click();
      closeAttachMenu();
    });

    // Close attach menu on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('#attach-btn') && !e.target.closest('#attach-menu')) {
        closeAttachMenu();
      }
    });

    // Reply bar close
    document.getElementById('reply-bar-close').addEventListener('click', clearReply);
  }

  // ─────────────────────────────────────────────────
  // Attach Menu
  // ─────────────────────────────────────────────────
  function toggleAttachMenu() {
    document.getElementById('attach-menu').classList.toggle('hidden');
  }

  function closeAttachMenu() {
    document.getElementById('attach-menu').classList.add('hidden');
  }

  // ─────────────────────────────────────────────────
  // Modals: New Chat
  // ─────────────────────────────────────────────────
  function openNewChatModal() {
    Auth.openModal('new-chat-modal');
    const searchEl = document.getElementById('new-chat-search');
    const results  = document.getElementById('new-chat-results');
    searchEl.value = '';
    results.innerHTML = '<div class="search-empty">Search for users by username</div>';
    searchEl.focus();

    let debounce;
    searchEl.oninput = () => {
      clearTimeout(debounce);
      const q = searchEl.value.trim();
      if (!q) { results.innerHTML = '<div class="search-empty">Search for users by username</div>'; return; }
      debounce = setTimeout(async () => {
        try {
          const { users } = await App.api('GET', `/users/search?q=${encodeURIComponent(q)}`);
          if (!users.length) { results.innerHTML = '<div class="search-empty">No users found</div>'; return; }
          results.innerHTML = users.map(u => `
            <div class="user-item" data-id="${u.id}">
              <div class="user-item-avatar">${App.avatarHtml(u.avatar, u.username, 44)}</div>
              <div class="user-item-info">
                <div class="user-item-name">${App.escHtml(u.username)}</div>
                <div class="user-item-sub">${App.state.onlineUsers.has(u.id) ? '🟢 Online' : App.formatLastSeen(u.last_seen)}</div>
              </div>
            </div>`).join('');
          results.querySelectorAll('.user-item').forEach(el => {
            el.addEventListener('click', () => startPrivateChat(Number(el.dataset.id)));
          });
        } catch { results.innerHTML = '<div class="search-empty">Error searching</div>'; }
      }, 300);
    };
  }

  // ─────────────────────────────────────────────────
  // Modals: New Group
  // ─────────────────────────────────────────────────
  let selectedMembers = new Map(); // id -> { username, avatar }

  function openNewGroupModal() {
    selectedMembers.clear();
    Auth.openModal('new-group-modal');
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-desc-input').value = '';
    document.getElementById('group-search').value = '';
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
        <div class="user-item-info">
          <div class="user-item-name">${App.escHtml(u.username)}</div>
        </div>
        <input type="checkbox" ${selectedMembers.has(u.id) ? 'checked' : ''}>
      </div>`).join('');

    results.querySelectorAll('.user-item').forEach(el => {
      el.addEventListener('click', () => {
        const uid = Number(el.dataset.id);
        const user = users.find(u => u.id === uid);
        const cb   = el.querySelector('input[type="checkbox"]');
        if (selectedMembers.has(uid)) { selectedMembers.delete(uid); cb.checked = false; }
        else                          { selectedMembers.set(uid, user); cb.checked = true; }
        renderSelectedMembers();
        checkGroupReady();
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
        renderSelectedMembers();
        renderGroupSearchResults([...selectedMembers.values()]);
        checkGroupReady();
      });
    });
  }

  function checkGroupReady() {
    const name = document.getElementById('group-name-input').value.trim();
    document.getElementById('create-group-btn').disabled = !name || selectedMembers.size === 0;
  }

  // ─────────────────────────────────────────────────
  // Chat Info
  // ─────────────────────────────────────────────────
  async function openChatInfo() {
    const convId = App.state.activeConvId;
    if (!convId) return;

    try {
      const { conversation, members } = await App.api('GET', `/messages/conversations/${convId}`);
      const modal = document.getElementById('chat-info-modal');

      modal.querySelector('.modal-title').textContent =
        conversation.type === 'group' ? 'Group Info' : 'Contact Info';

      modal.querySelector('#info-avatar').innerHTML = App.avatarHtml(
        conversation.avatar, conversation.name, 80
      );
      modal.querySelector('#info-name').textContent = conversation.name;
      modal.querySelector('#info-desc').textContent = conversation.description || '';

      const memberList = modal.querySelector('#info-members');
      if (conversation.type === 'group') {
        memberList.innerHTML = members.map(m => `
          <div class="user-item">
            <div class="user-item-avatar">${App.avatarHtml(m.avatar, m.username, 44)}</div>
            <div class="user-item-info">
              <div class="user-item-name">${App.escHtml(m.username)}</div>
              <div class="user-item-sub">${m.role === 'admin' ? '⭐ Admin' : 'Member'}</div>
            </div>
          </div>`).join('');
        memberList.parentElement.classList.remove('hidden');
      } else {
        memberList.parentElement.classList.add('hidden');
      }

      Auth.openModal('chat-info-modal');
    } catch (err) {
      App.showToast('Failed to load info', 'error');
    }
  }

  return {
    init, loadConversations, openConversation,
    handleIncomingMessage, handleTyping, handleMessagesRead, handleUserStatus,
    sendMessage, sendVoiceMessage,
    renderConversationList
  };
})();
