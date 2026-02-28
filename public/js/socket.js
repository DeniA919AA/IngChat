/**
 * IngChat — Socket.io client
 */

window.SocketClient = (() => {
  let socket = null;

  function connect(token) {
    if (socket?.connected) return;

    socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      // Re-fetch online statuses after reconnect
      if (App.state.conversations.length) {
        const allUserIds = getAllContactIds();
        if (allUserIds.length) getOnlineStatus(allUserIds);
      }
    });

    socket.on('disconnect', reason => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', err => {
      console.warn('[Socket] Connection error:', err.message);
    });

    // ── Incoming Events ──────────────────────────────
    socket.on('new_message', message => {
      Chat.handleIncomingMessage(message);
    });

    socket.on('user_typing', ({ userId, username, conversationId, isTyping }) => {
      Chat.handleTyping(userId, username, conversationId, isTyping);
    });

    socket.on('messages_read', ({ userId, conversationId, messageIds }) => {
      Chat.handleMessagesRead(userId, conversationId, messageIds);
    });

    socket.on('user_status', ({ userId, isOnline, lastSeen }) => {
      Chat.handleUserStatus(userId, isOnline, lastSeen);
    });

    socket.on('conversation_updated', ({ conversationId }) => {
      Chat.loadConversations();
    });
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
  }

  function emit(event, data, callback) {
    if (!socket?.connected) {
      App.showToast('Connection lost. Reconnecting…', 'warn');
      return false;
    }
    socket.emit(event, data, callback);
    return true;
  }

  function sendMessage(data, callback) {
    return emit('send_message', data, callback);
  }

  function setTyping(conversationId, isTyping) {
    emit('typing', { conversationId, isTyping });
  }

  function markRead(conversationId, messageIds) {
    if (messageIds.length) emit('mark_read', { conversationId, messageIds });
  }

  function joinConversation(conversationId) {
    emit('join_conversation', conversationId);
  }

  function getOnlineStatus(userIds, callback) {
    if (!socket?.connected) return;
    socket.emit('get_online_status', userIds, callback || (status => {
      for (const [uid, online] of Object.entries(status)) {
        if (online) App.state.onlineUsers.add(Number(uid));
        else        App.state.onlineUsers.delete(Number(uid));
      }
    }));
  }

  function getAllContactIds() {
    const ids = new Set();
    for (const conv of App.state.conversations) {
      if (conv.type === 'private' && conv.other_user_id) ids.add(conv.other_user_id);
    }
    return [...ids];
  }

  return { connect, disconnect, sendMessage, setTyping, markRead, joinConversation, getOnlineStatus };
})();
