/**
 * IngChat — Socket.io клиент
 */

window.SocketClient = (() => {
  let socket = null;

  function connect(token) {
    if (socket?.connected) return;

    socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[Socket] Подключено:', socket.id);
      if (App.state.conversations.length) {
        const allUserIds = getAllContactIds();
        if (allUserIds.length) getOnlineStatus(allUserIds);
      }
    });

    socket.on('disconnect', reason => {
      console.log('[Socket] Отключено:', reason);
    });

    socket.on('connect_error', err => {
      console.warn('[Socket] Ошибка подключения:', err.message);
    });

    socket.on('new_message',        message => Chat.handleIncomingMessage(message));
    socket.on('user_typing',        data    => Chat.handleTyping(data.userId, data.username, data.conversationId, data.isTyping));
    socket.on('messages_read',      data    => Chat.handleMessagesRead(data.userId, data.conversationId, data.messageIds));
    socket.on('user_status',        data    => Chat.handleUserStatus(data.userId, data.isOnline, data.lastSeen));
    socket.on('conversation_updated', ()    => Chat.loadConversations());
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
  }

  function emit(event, data, callback) {
    if (!socket?.connected) {
      App.showToast('Соединение потеряно. Переподключение…', 'warn');
      return false;
    }
    socket.emit(event, data, callback);
    return true;
  }

  function sendMessage(data, callback)       { return emit('send_message', data, callback); }
  function setTyping(conversationId, isTyping) { emit('typing', { conversationId, isTyping }); }
  function markRead(conversationId, messageIds) { if (messageIds.length) emit('mark_read', { conversationId, messageIds }); }
  function joinConversation(conversationId)    { emit('join_conversation', conversationId); }

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
