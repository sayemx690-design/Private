 
    // ========================================
    // CONFIG & STATE
    // ========================================
    
    let currentUser = null;
    let currentChat = null;
    let currentChatUser = null;
    let messagesRef = null;
    let typingRef = null;
    let chatListRef = null;
    let userStatusRef = null;
    let replyTo = null;
    let typingTimeout = null;
    let isLoading = false;
    let pendingMessages = new Map();
    let lastMessageCount = 0; // Track message count for sound
    
    
    let db = null;
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    } catch(e) {
      console.error('Firebase init error:', e);
    }
    
    // ========================================
    // SOUND SYSTEM (LOUDER)
    // ========================================
    
    let audioContext = null;
    
    function initAudio() {
      if (!audioContext) {
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {
          console.log('Web Audio API not supported');
        }
      }
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
    }
    
    function playSound(type) {
      try {
        initAudio();
        if (!audioContext) return;
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        const now = audioContext.currentTime;
        
        if (type === 'send') {
          // Outgoing message sound: Quick descending tone
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(900, now);
          oscillator.frequency.exponentialRampToValueAtTime(400, now + 0.15);
          
          // Louder volume for send
          gainNode.gain.setValueAtTime(0.8, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          
          oscillator.start(now);
          oscillator.stop(now + 0.15);
        } else if (type === 'receive') {
          // Incoming message sound: Double bell ding
          oscillator.type = 'sine';
          
          // First ding
          oscillator.frequency.setValueAtTime(880, now);
          gainNode.gain.setValueAtTime(0.6, now);
          
          // Second ding (higher pitch)
          oscillator.frequency.setValueAtTime(1320, now + 0.1);
          gainNode.gain.setValueAtTime(0.6, now + 0.1);
          
          // Fade out
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
          
          oscillator.start(now);
          oscillator.stop(now + 0.3);
        }
      } catch(e) {
        console.log('Sound error:', e);
      }
    }
    
    // Initialize audio on first touch/click
    document.addEventListener('click', () => initAudio(), { once: true });
    document.addEventListener('touchstart', () => initAudio(), { once: true });
    
    // ========================================
    // UTILITY FUNCTIONS
    // ========================================
    
    function generateId() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
    
    function showToast(message) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
    
    function formatTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      if (diff < 86400000 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      } else if (diff < 604800000) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    
    function formatLastSeen(timestamp) {
      if (!timestamp) return 'Offline';
      const diff = Date.now() - timestamp;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    function getChatId(id1, id2) {
      return [id1, id2].sort().join('_');
    }
    
    function getAvatarUrl(user) {
      if (user && user.photo) return user.photo;
      const seed = user ? (user.name || user.id || 'default') : 'default';
      return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // ========================================
    // NAVIGATION SYSTEM (ANDROID BACK SUPPORT)
    // ========================================
    
    function showPage(pageName, addToHistory = true) {
      const currentPage = document.querySelector('.page.active');
      const targetPage = document.getElementById(`page-${pageName}`);
      
      // Update DOM classes for animation
      if (currentPage && currentPage !== targetPage) {
        currentPage.classList.remove('active');
        if (pageName === 'chat' || pageName === 'profile') {
          currentPage.classList.add('slide-left');
        }
      }
      
      if (targetPage) {
        targetPage.classList.remove('slide-left');
        targetPage.classList.add('active');
      }
      
      const menu = document.getElementById('menu-dropdown');
      if (menu) menu.classList.add('hidden');
      
      // Manage History Stack for Android Back Button
      if (addToHistory) {
        history.pushState({ page: pageName }, '', `#${pageName}`);
      }
    }
    
    // Android Back Button Handler
    window.onpopstate = function(e) {
      if (!e.state || !e.state.page) {
        // If no state, default to login or close app behavior
        if (currentUser) showPage('home', false);
        else showPage('login', false);
        return;
      }
      
      const targetPage = e.state.page;
      
      // If we are leaving the Chat page, we must clean up listeners
      // to ensure proper behavior and memory management
      if (currentChat && targetPage !== 'chat') {
        cleanupChat();
      }
      
      // Update DOM to reflect history state
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active', 'slide-left'));
      const targetEl = document.getElementById(`page-${targetPage}`);
      if (targetEl) targetEl.classList.add('active');
      
      // Refresh data if needed
      if (targetPage === 'home') loadHomeData();
      if (targetPage === 'profile') loadProfile();
    };
    
    // ========================================
    // AUTH SYSTEM
    // ========================================
    
    function createAccount() {
      if (isLoading) return;
      
      const name = document.getElementById('create-name').value.trim();
      const password = document.getElementById('create-password').value;
      const photo = document.getElementById('create-photo').value.trim();
      
      if (!name) return showToast('Please enter your name');
      if (!password) return showToast('Please enter a password');
      if (password.length < 4) return showToast('Password must be at least 4 characters');
      
      if (!db) return showToast('Database not connected');
      
      isLoading = true;
      const btn = document.getElementById('create-btn');
      const btnText = document.getElementById('create-btn-text');
      btn.disabled = true;
      btnText.innerHTML = '<div class="flex items-center justify-center gap-2"><div class="spinner"></div><span>Creating...</span></div>';
      
      const userId = generateId();
      const userData = {
        name: name,
        password: password,
        photo: photo || '',
        online: true,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      
      db.ref(`users/${userId}`).set(userData)
        .then(() => {
          currentUser = { id: userId, name, password, photo: photo || '' };
          localStorage.setItem('chatflow_session', JSON.stringify(currentUser));
          initOnlineStatus();
          showToast('Account created!');
          showPage('home');
          loadHomeData();
        })
        .catch(err => {
          console.error('Create account error:', err);
          showToast('Error: ' + err.message);
        })
        .finally(() => {
          isLoading = false;
          btn.disabled = false;
          btnText.textContent = 'Create Account';
        });
    }
    
    function loginUser() {
      if (isLoading) return;
      
      const password = document.getElementById('login-password').value;
      
      if (!password) {
        showToast('Please enter your password');
        return;
      }
      
      if (!db) return showToast('Database not connected');
      
      isLoading = true;
      const btn = document.getElementById('login-btn');
      const btnText = document.getElementById('login-btn-text');
      btn.disabled = true;
      btnText.innerHTML = '<div class="flex items-center justify-center gap-2"><div class="spinner"></div><span>Logging in...</span></div>';
      
      db.ref('users').once('value')
        .then(snapshot => {
          const users = snapshot.val();
          if (!users) {
            showToast('No accounts found');
            return;
          }
          
          let foundUser = null;
          let foundId = null;
          
          for (const uid in users) {
            if (users[uid].password === password) {
              foundUser = users[uid];
              foundId = uid;
              break;
            }
          }
          
          if (foundUser && foundId) {
            currentUser = { id: foundId, ...foundUser };
            localStorage.setItem('chatflow_session', JSON.stringify(currentUser));
            initOnlineStatus();
            showToast('Welcome back, ' + foundUser.name + '!');
            showPage('home');
            loadHomeData();
          } else {
            showToast('Invalid password');
          }
        })
        .catch(err => {
          console.error('Login error:', err);
          showToast('Login failed: ' + err.message);
        })
        .finally(() => {
          isLoading = false;
          btn.disabled = false;
          btnText.textContent = 'Log In';
        });
    }
    
    function logoutUser() {
      if (currentUser && db) {
        db.ref(`users/${currentUser.id}`).update({
          online: false,
          lastSeen: firebase.database.ServerValue.TIMESTAMP
        }).catch(e => console.log('Logout update error:', e));
      }
      
      if (userStatusRef) { userStatusRef.off(); userStatusRef = null; }
      if (chatListRef) { chatListRef.off(); chatListRef = null; }
      
      localStorage.removeItem('chatflow_session');
      currentUser = null;
      currentChat = null;
      currentChatUser = null;
      
      const menu = document.getElementById('menu-dropdown');
      if (menu) menu.classList.add('hidden');
      
      // Clear history and go to login
      history.pushState({ page: 'login' }, '', '#login');
      showPage('login', false);
      showToast('Logged out');
    }
    
    function autoLogin() {
      // Changed: Always require password login on app start
      // Local data remains in localStorage but auto-login is disabled
      showPage('login');
    }
    
    // ========================================
    // ONLINE STATUS SYSTEM
    // ========================================
    
    function initOnlineStatus() {
      if (!currentUser || !db) return;
      
      userStatusRef = db.ref(`users/${currentUser.id}`);
      
      userStatusRef.update({
        online: true,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      }).catch(e => console.log('Status update error:', e));
      
      userStatusRef.onDisconnect().update({
        online: false,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      });
      
      document.addEventListener('visibilitychange', () => {
        if (currentUser && db) {
          db.ref(`users/${currentUser.id}`).update({
            online: !document.hidden,
            lastSeen: firebase.database.ServerValue.TIMESTAMP
          }).catch(e => {});
        }
      });
    }
    
    // ========================================
    // HOME PAGE & CHAT LIST PERSISTENCE
    // ========================================
    
    function loadHomeData() {
      if (!currentUser || !db) return;
      
      if (chatListRef) chatListRef.off();
      
      // Listen for ALL chats and filter on client side
      // This ensures any new chat created via Search stays in the list
      chatListRef = db.ref('chats');
      chatListRef.on('value', snapshot => {
        const chats = snapshot.val() || {};
        renderChatList(chats);
      }, error => console.error('Chat list error:', error));
    }
    
    function renderChatList(chats) {
      const container = document.getElementById('chat-list');
      const emptyState = document.getElementById('empty-state');
      
      if (!container || !emptyState) return;
      
      const myChats = [];
      
      // Filter chats where current user is a participant
      Object.keys(chats).forEach(chatId => {
        const chat = chats[chatId];
        if (chat && (chat.userId1 === currentUser.id || chat.userId2 === currentUser.id)) {
          const otherId = chat.userId1 === currentUser.id ? chat.userId2 : chat.userId1;
          myChats.push({ chatId, otherId, ...chat });
        }
      });
      
      if (myChats.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
      }
      
      emptyState.classList.add('hidden');
      
      // Sort by most recent message
      myChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      // Fetch user details for each chat
      const promises = myChats.map(chat => {
        return db.ref(`users/${chat.otherId}`).once('value').then(snap => ({
          ...chat,
          otherUser: snap.val()
        })).catch(() => ({ ...chat, otherUser: null }));
      });
      
      Promise.all(promises).then(chatData => {
        container.innerHTML = chatData.map((chat, i) => {
          const user = chat.otherUser;
          if (!user) return '';
          
          const unreadKey = `unread_${currentUser.id}`;
          const unread = chat[unreadKey] || 0;
          const avatar = getAvatarUrl(user);
          
          return `
            <div class="chat-item animate-smooth" style="animation-delay: ${i * 40}ms" onclick="startChat('${chat.otherId}')">
              <div class="chat-item-avatar">
                <img src="${avatar}" class="w-14 h-14 rounded-full bg-gray-100" alt="">
                ${user.online ? '<div class="online-indicator"></div>' : ''}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <span class="font-semibold truncate">${escapeHtml(user.name || 'User')}</span>
                  <span class="text-xs text-[var(--text-secondary)]">${formatTime(chat.timestamp)}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-[var(--text-secondary)] truncate pr-2">${escapeHtml(chat.lastMessage || 'Tap to start chat')}</span>
                  ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      });
    }
    
    // ========================================
    // SEARCH SYSTEM
    // ========================================
    
    function searchUsers(query) {
      const results = document.getElementById('search-results');
      if (!results) return;
      
      if (!query.trim()) {
        results.classList.add('hidden');
        return;
      }
      
      if (!db) return;
      
      db.ref('users').once('value')
        .then(snapshot => {
          const users = snapshot.val() || {};
          const matches = Object.keys(users)
            .filter(id => id !== currentUser.id)
            .filter(id => {
              const u = users[id];
              return u && u.name && u.name.toLowerCase().includes(query.toLowerCase());
            })
            .slice(0, 5);
          
          if (matches.length === 0) {
            results.innerHTML = '<div class="p-4 text-center text-[var(--text-secondary)]">No users found</div>';
          } else {
            results.innerHTML = matches.map(id => {
              const u = users[id];
              const avatar = getAvatarUrl(u);
              return `
                <div class="chat-item" onclick="startChat('${id}')">
                  <img src="${avatar}" class="w-10 h-10 rounded-full mr-3 bg-gray-100" alt="">
                  <div class="flex-1">
                    <div class="font-medium">${escapeHtml(u.name)}</div>
                    <div class="text-xs text-[var(--text-secondary)]">${u.online ? 'Online' : formatLastSeen(u.lastSeen)}</div>
                  </div>
                </div>
              `;
            }).join('');
          }
          
          results.classList.remove('hidden');
        });
    }
    
    document.addEventListener('click', (e) => {
      const searchInput = document.getElementById('search-input');
      const searchResults = document.getElementById('search-results');
      if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.classList.add('hidden');
      }
    });
    
    // ========================================
    // MENU SYSTEM
    // ========================================
    
    function toggleMenu() {
      const menu = document.getElementById('menu-dropdown');
      if (menu) menu.classList.toggle('hidden');
    }
    
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('menu-dropdown');
      if (menu && !e.target.closest('.relative') && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
      }
    });
    
    // ========================================
    // CHAT SYSTEM
    // ========================================
    
    function startChat(otherId) {
      if (!db || !currentUser) return;
      
      // Hide search results immediately
      const searchResults = document.getElementById('search-results');
      const searchInput = document.getElementById('search-input');
      if (searchResults) searchResults.classList.add('hidden');
      if (searchInput) searchInput.value = '';
      
      // Get user info
      db.ref(`users/${otherId}`).once('value')
        .then(snapshot => {
          const userData = snapshot.val();
          if (!userData) {
            showToast('User not found');
            return;
          }
          
          currentChatUser = { id: otherId, ...userData };
          const chatId = getChatId(currentUser.id, otherId);
          currentChat = chatId;
          
          // *** KEY LOGIC FOR CHAT LIST PERSISTENCE ***
          // Create/Update the chat entry in database so it appears in the home list
          const chatRef = db.ref(`chats/${chatId}`);
          chatRef.transaction(chat => {
            if (!chat) {
              // Create new chat entry if it doesn't exist
              return {
                userId1: currentUser.id,
                userId2: otherId,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                lastMessage: '' // Empty initially
              };
            }
            // If chat exists, just return it (no update needed here, messages update timestamp)
            return chat;
          }).then(() => {
            openChat();
          });
        })
        .catch(err => {
          console.error('Start chat error:', err);
          showToast('Failed to start chat');
        });
    }
    
    function openChat() {
      if (!currentChat || !currentChatUser || !db) return;
      
      const chatName = document.getElementById('chat-name');
      const chatAvatar = document.getElementById('chat-avatar');
      
      if (chatName) chatName.textContent = currentChatUser.name || 'User';
      if (chatAvatar) chatAvatar.src = getAvatarUrl(currentChatUser);
      
      // Listen for user status updates
      db.ref(`users/${currentChatUser.id}`).on('value', snap => {
        const data = snap.val();
        if (data && currentChatUser) {
          currentChatUser = { ...currentChatUser, ...data };
          updateChatStatus();
        }
      });
      
      // Listen for typing status
      typingRef = db.ref(`chats/${currentChat}/typing_${currentChatUser.id}`);
      typingRef.on('value', snap => {
        const status = document.getElementById('chat-status');
        if (!status) return;
        
        if (snap.val()) {
          status.className = '';
          status.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
        } else {
          updateChatStatus();
        }
      });
      
      loadMessages();
      markMessagesAsRead();
      showPage('chat');
    }
    
    function updateChatStatus() {
      const status = document.getElementById('chat-status');
      if (!status || !currentChatUser) return;
      
      if (currentChatUser.online) {
        status.textContent = 'Online';
        status.className = 'status-online';
      } else {
        status.textContent = formatLastSeen(currentChatUser.lastSeen);
        status.className = 'status-offline';
      }
    }
    
    // Cleanup function for closing chat
    function cleanupChat() {
      if (messagesRef) { messagesRef.off(); messagesRef = null; }
      if (typingRef) { typingRef.off(); typingRef = null; }
      
      if (currentChatUser && db) {
        db.ref(`users/${currentChatUser.id}`).off();
      }
      
      currentChat = null;
      currentChatUser = null;
      replyTo = null;
      pendingMessages.clear();
      lastMessageCount = 0; // Reset count
      
      const replyBox = document.getElementById('reply-box');
      if (replyBox) replyBox.classList.add('hidden');
    }
    
    function closeChat() {
      // Use history.back() to trigger popstate event for proper Android back behavior
      history.back();
    }
    
    function loadMessages() {
      const container = document.getElementById('messages-list');
      if (!container || !db) return;
      
      container.innerHTML = '<div class="flex justify-center py-8"><div class="spinner" style="border-top-color: var(--accent); border-color: rgba(37,211,102,0.3);"></div></div>';
      
      messagesRef = db.ref(`messages/${currentChat}`);
      messagesRef.orderByChild('timestamp').on('value', snapshot => {
        const messages = snapshot.val() || {};
        renderMessages(messages);
      }, error => {
        console.error('Messages error:', error);
        container.innerHTML = '<div class="text-center text-gray-500 py-8">Failed to load messages</div>';
      });
    }
    
    function renderMessages(messages) {
      const container = document.getElementById('messages-list');
      if (!container) return;
      
      const allMessages = { ...messages };
      pendingMessages.forEach((msg, id) => {
        if (!allMessages[id]) allMessages[id] = msg;
      });
      
      const msgArray = Object.entries(allMessages)
        .map(([id, msg]) => ({ id, ...msg }))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      // Sound Logic: Check for new incoming messages
      // Only play if we have loaded messages before (lastMessageCount > 0) 
      // AND the count has increased
      if (lastMessageCount > 0 && msgArray.length > lastMessageCount) {
        const lastMsg = msgArray[msgArray.length - 1];
        // Check if the new message is NOT from current user (incoming)
        if (lastMsg.senderId !== currentUser.id) {
          playSound('receive');
        }
      }
      // Update count after checking
      lastMessageCount = msgArray.length;
      
      if (msgArray.length === 0) {
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center py-16 text-[var(--text-secondary)]">
            <svg class="w-16 h-16 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
            </svg>
            <p class="text-sm">No messages yet</p>
            <p class="text-xs mt-1">Say hello!</p>
          </div>
        `;
        return;
      }
      
      let html = '';
      let lastDate = '';
      
      msgArray.forEach((msg, i) => {
        const timestamp = msg.timestamp || Date.now();
        const date = new Date(timestamp).toDateString();
        
        if (date !== lastDate) {
          lastDate = date;
          const label = date === new Date().toDateString() ? 'Today' : new Date(timestamp).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          html += `<div class="date-separator"><span>${label}</span></div>`;
        }
        
        const isOutgoing = msg.senderId === currentUser.id;
        const isPending = pendingMessages.has(msg.id);
        
        html += renderBubble(msg, isOutgoing, isPending, i);
      });
      
      container.innerHTML = html;
      scrollToBottom();
    }
    
    function renderBubble(msg, isOutgoing, isPending, index) {
      const time = formatTime(msg.timestamp);
      const wrapperClass = isOutgoing ? 'outgoing' : 'incoming';
      const bubbleClass = isOutgoing ? 'bubble-outgoing' : 'bubble-incoming';
      const animDelay = index * 20;
      
      let checkmark = '';
      if (isOutgoing) {
        if (isPending) {
          checkmark = `<span class="checkmark"><svg viewBox="0 0 16 11"><path d="M2 5.5L6 9.5L14 1.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
        } else if (msg.status === 'read') {
          checkmark = `<span class="checkmark read"><svg viewBox="0 0 16 11"><path d="M2 5.5L5.5 9M5.5 9L14 1M5.5 9L9 5.5L14 1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
        } else {
          checkmark = `<span class="checkmark"><svg viewBox="0 0 16 11"><path d="M2 5.5L5.5 9M5.5 9L14 1M5.5 9L9 5.5L14 1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
        }
      }
      
      const replyHtml = msg.replyTo ? `
        <div class="reply-preview">
          <div class="reply-preview-name">${escapeHtml(msg.replyName || 'Reply')}</div>
          <div class="reply-preview-text">${escapeHtml(msg.replyText || '')}</div>
        </div>
      ` : '';
      
      return `
        <div class="bubble-wrapper ${wrapperClass} animate-message-in" style="animation-delay: ${animDelay}ms" onclick="setReply('${msg.senderId}', '${escapeHtml(msg.text || '').substring(0, 100).replace(/'/g, "\\'")}')">
          <div class="bubble ${bubbleClass}">
            ${replyHtml}
            <div>${escapeHtml(msg.text || '')}</div>
            <div class="bubble-time">
              ${time}
              ${checkmark}
            </div>
          </div>
        </div>
      `;
    }
    
    function scrollToBottom() {
      const container = document.getElementById('messages-container');
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }
    
    // ========================================
    // MESSAGE SYSTEM
    // ========================================
    
    function sendMessage() {
      if (!currentChat || !currentUser || !db) return;
      
      const input = document.getElementById('message-input');
      if (!input) return;
      
      const text = input.value.trim();
      if (!text) return;
      
      const msgId = generateId();
      const timestamp = Date.now();
      
      const msgData = {
        senderId: currentUser.id,
        text: text,
        timestamp: timestamp,
        status: 'sending'
      };
      
      if (replyTo) {
        msgData.replyTo = replyTo.id;
        msgData.replyText = replyTo.text;
        msgData.replyName = replyTo.name;
      }
      
      pendingMessages.set(msgId, { ...msgData, status: 'sent' });
      
      input.value = '';
      input.style.height = 'auto';
      cancelReply();
      
      // Play send sound
      playSound('send');
      
      const sendBtn = document.getElementById('send-btn');
      if (sendBtn) {
        sendBtn.classList.add('animate-send-pulse');
        setTimeout(() => sendBtn.classList.remove('animate-send-pulse'), 200);
      }
      
      renderMessages({});
      
      // Send to Firebase
      db.ref(`messages/${currentChat}/${msgId}`).set({
        ...msgData,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        status: 'sent'
      }).then(() => {
        pendingMessages.delete(msgId);
        
        // *** UPDATE CHAT LIST TIMESTAMP & LAST MESSAGE ***
        // This ensures the chat moves to top of the list and shows recent message
        db.ref(`chats/${currentChat}`).update({
          lastMessage: text.substring(0, 50),
          timestamp: firebase.database.ServerValue.TIMESTAMP,
          [`unread_${currentChatUser.id}`]: firebase.database.ServerValue.increment(1)
        });
      }).catch(err => {
        console.error('Send message error:', err);
        pendingMessages.delete(msgId);
        showToast('Failed to send');
      });
    }
    
    function handleMessageKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }
    
    function handleTyping() {
      if (!currentChat || !currentUser || !db) return;
      
      const input = document.getElementById('message-input');
      if (input) {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      }
      
      db.ref(`chats/${currentChat}/typing_${currentUser.id}`).set(true);
      
      if (typingTimeout) clearTimeout(typingTimeout);
      
      typingTimeout = setTimeout(() => {
        if (db && currentChat && currentUser) {
          db.ref(`chats/${currentChat}/typing_${currentUser.id}`).set(false);
        }
      }, 1000);
    }
    
    function markMessagesAsRead() {
      if (!currentChat || !currentUser || !db) return;
      
      const unreadKey = `unread_${currentUser.id}`;
      db.ref(`chats/${currentChat}/${unreadKey}`).set(0);
      
      db.ref(`messages/${currentChat}`).once('value')
        .then(snapshot => {
          const updates = {};
          snapshot.forEach(child => {
            const msg = child.val();
            if (msg && msg.senderId !== currentUser.id && msg.status !== 'read') {
              updates[`${child.key}/status`] = 'read';
            }
          });
          if (Object.keys(updates).length > 0) {
            db.ref(`messages/${currentChat}`).update(updates);
          }
        });
    }
    
    // ========================================
    // REPLY SYSTEM
    // ========================================
    
    function setReply(senderId, text) {
      if (!currentChatUser) return;
      
      replyTo = {
        id: senderId,
        text: text,
        name: senderId === currentUser.id ? 'You' : currentChatUser.name
      };
      
      const replyName = document.getElementById('reply-name');
      const replyText = document.getElementById('reply-text');
      const replyBox = document.getElementById('reply-box');
      
      if (replyName) replyName.textContent = replyTo.name;
      if (replyText) replyText.textContent = replyTo.text;
      if (replyBox) replyBox.classList.remove('hidden');
      
      document.getElementById('message-input').focus();
    }
    
    function cancelReply() {
      replyTo = null;
      const replyBox = document.getElementById('reply-box');
      if (replyBox) replyBox.classList.add('hidden');
    }
    
    // ========================================
    // PROFILE SYSTEM
    // ========================================
    
    function loadProfile() {
      if (!currentUser) return;
      
      const nameInput = document.getElementById('profile-name');
      const photoInput = document.getElementById('profile-photo');
      const passwordInput = document.getElementById('profile-password');
      const avatarPreview = document.getElementById('profile-avatar-preview');
      
      if (nameInput) nameInput.value = currentUser.name || '';
      if (photoInput) photoInput.value = currentUser.photo || '';
      if (passwordInput) passwordInput.value = currentUser.password || '';
      if (avatarPreview) avatarPreview.src = getAvatarUrl(currentUser);
    }
    
    function updateProfileAvatarPreview() {
      const photoInput = document.getElementById('profile-photo');
      const avatarPreview = document.getElementById('profile-avatar-preview');
      
      if (!avatarPreview) return;
      
      const photo = photoInput ? photoInput.value.trim() : '';
      avatarPreview.src = photo || getAvatarUrl(currentUser);
    }
    
    function updateAvatarPreview() {
      const photoInput = document.getElementById('create-photo');
      const preview = document.getElementById('create-avatar-preview');
      const nameInput = document.getElementById('create-name');
      
      if (!preview) return;
      
      const photo = photoInput ? photoInput.value.trim() : '';
      const name = nameInput ? nameInput.value.trim() : 'default';
      preview.src = photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
    }
    
    function saveProfile() {
      if (!currentUser || !db) return;
      
      const name = document.getElementById('profile-name').value.trim();
      const photo = document.getElementById('profile-photo').value.trim();
      
      if (!name) {
        showToast('Name is required');
        return;
      }
      
      db.ref(`users/${currentUser.id}`).update({
        name: name,
        photo: photo
      }).then(() => {
        currentUser.name = name;
        currentUser.photo = photo;
        localStorage.setItem('chatflow_session', JSON.stringify(currentUser));
        showToast('Profile saved!');
        history.back(); // Use history back for consistency
      }).catch(err => {
        console.error('Save profile error:', err);
        showToast('Failed to save');
      });
    }
    
    // ========================================
    // INITIALIZATION
    // ========================================
    
    document.addEventListener('DOMContentLoaded', () => {
      // Profile page observer
      const profilePage = document.getElementById('page-profile');
      if (profilePage) {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.target.classList.contains('active')) {
              loadProfile();
            }
          });
        });
        observer.observe(profilePage, { attributes: true, attributeFilter: ['class'] });
      }
      
      autoLogin();
    });
    
    // Initialize history state on load
    if (!window.location.hash || window.location.hash === '#') {
      history.replaceState({ page: 'login' }, '', '#login');
    }
  