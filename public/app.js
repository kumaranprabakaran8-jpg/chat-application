const app = document.getElementById('app');
let state = {
  user: null,
  chats: [],
  activeChat: null,
  messages: [],
  loading: false,
  darkMode: true,
  search: '',
  settingsOpen: false,
  generating: false,
  stopRequested: false
};

function render() {
  if (!state.user) return renderAuth();
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">Nova Chat</div>
        <input id="search" class="search" placeholder="Search chats" value="${state.search}" />
        <button class="btn" id="new-chat">+ New chat</button>
        <div class="list" id="chat-list"></div>
        <div class="footer-actions">
          <button class="btn secondary" id="settings">Settings</button>
          <button class="btn secondary" id="logout">Logout</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <strong>${state.activeChat ? state.activeChat.title : 'New chat'}</strong>
            <div class="muted">Glassmorphism AI workspace</div>
          </div>
          <div class="topbar-actions">
            <button class="btn secondary" id="regenerate">Regenerate</button>
            <button class="btn secondary" id="export">Export</button>
            <button class="btn secondary" id="theme">${state.darkMode ? '☀️' : '🌙'}</button>
          </div>
        </div>
        ${state.settingsOpen ? `<div class="settings-card"><strong>Preferences</strong><div class="muted">Dark mode is ${state.darkMode ? 'enabled' : 'disabled'}. You can switch anytime.</div></div>` : ''}
        <div class="messages" id="messages"></div>
        <div class="composer">
          <textarea id="prompt" placeholder="Ask anything..."></textarea>
          <button class="btn" id="send">Send</button>
        </div>
        ${state.generating ? '<button class="btn secondary stop" id="stop">Stop generation</button>' : ''}
      </main>
    </div>
  `;
  document.getElementById('chat-list').innerHTML = filteredChats().map(chat => `
    <div class="chat-item ${state.activeChat && state.activeChat.id === chat.id ? 'active' : ''}" data-id="${chat.id}">
      <div class="chat-meta">
        <strong>${escapeHtml(chat.title)}</strong>
        <div class="muted">${new Date(chat.updated_at).toLocaleString()}</div>
      </div>
      <div class="chat-actions">
        <button class="mini" data-action="rename" data-id="${chat.id}">✎</button>
        <button class="mini danger" data-action="delete" data-id="${chat.id}">✕</button>
      </div>
    </div>
  `).join('');
  renderMessages();
  bindEvents();
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth">
      <h2>Welcome to Nova Chat</h2>
      <p class="muted">Sign in to continue</p>
      <div class="field"><label>Email</label><input id="email" /></div>
      <div class="field"><label>Password</label><input id="password" type="password" /></div>
      <button class="btn" id="login">Login</button>
      <button class="btn secondary" id="register" style="margin-top:8px">Register</button>
      <button class="btn secondary" id="guest" style="margin-top:8px">Continue as Guest</button>
    </div>
  `;
  bindAuthEvents();
}

function renderMessages() {
  const container = document.getElementById('messages');
  if (!container) return;
  if (!state.messages.length) {
    container.innerHTML = '<div class="empty-state">Start a conversation and enjoy a polished AI workspace.</div>';
    return;
  }
  container.innerHTML = state.messages.map(msg => `
    <div class="bubble ${msg.role}">
      <div class="bubble-content">${renderMarkdown(msg.content)}</div>
      ${msg.role === 'assistant' && msg.content.includes('```') ? '<button class="copy-code">Copy code</button>' : ''}
    </div>
  `).join('');
  container.querySelectorAll('.copy-code').forEach(btn => btn.onclick = () => {
    const code = btn.parentElement.querySelector('.bubble-content').textContent;
    navigator.clipboard.writeText(code);
  });
}

function bindEvents() {
  document.getElementById('new-chat').onclick = async () => {
    const chat = await api('/api/chats', { method: 'POST', body: { title: 'New chat' } });
    state.chats.unshift(chat.chat);
    state.activeChat = chat.chat;
    state.messages = [];
    render();
  };
  document.getElementById('logout').onclick = () => { localStorage.removeItem('token'); state.user = null; render(); };
  document.getElementById('settings').onclick = () => { state.settingsOpen = !state.settingsOpen; render(); };
  document.getElementById('theme').onclick = () => { state.darkMode = !state.darkMode; document.body.classList.toggle('light', !state.darkMode); render(); };
  document.getElementById('export').onclick = () => {
    const blob = new Blob([JSON.stringify(state.messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'chat-export.json'; a.click(); URL.revokeObjectURL(url);
  };
  document.getElementById('search').oninput = (e) => { state.search = e.target.value; render(); };
  document.getElementById('regenerate').onclick = regenerateLast;
  document.getElementById('send').onclick = sendMessage;
  document.getElementById('stop').onclick = () => { state.stopRequested = true; state.generating = false; render(); };
  document.getElementById('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  document.querySelectorAll('.chat-item').forEach(item => item.onclick = async (e) => {
    if (e.target.closest('button')) return;
    const id = Number(item.dataset.id); state.activeChat = state.chats.find(c => c.id === id); await loadChat(id); render();
  });
  document.querySelectorAll('.mini').forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'delete') {
      await api(`/api/chats/${id}`, { method: 'DELETE' });
      state.chats = state.chats.filter(chat => chat.id !== id);
      if (state.activeChat?.id === id) { state.activeChat = state.chats[0] || null; state.messages = []; }
      render();
    } else if (btn.dataset.action === 'rename') {
      const newTitle = prompt('Rename chat', state.chats.find(chat => chat.id === id)?.title || '');
      if (newTitle) {
        await api(`/api/chats/${id}`, { method: 'PUT', body: { title: newTitle } });
        state.chats = state.chats.map(chat => chat.id === id ? { ...chat, title: newTitle } : chat);
        render();
      }
    }
  });
}

function bindAuthEvents() {
  document.getElementById('login').onclick = async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    state.user = data.user;
    await init();
  };
  document.getElementById('register').onclick = async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await api('/api/auth/register', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    state.user = data.user;
    await init();
  };
  document.getElementById('guest').onclick = async () => {
    const data = await api('/api/guest', { method: 'POST' });
    localStorage.setItem('token', data.token);
    state.user = data.user;
    await init();
  };
}

async function init() {
  const token = localStorage.getItem('token');
  if (!token) { renderAuth(); return; }
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    const chats = await api('/api/chats');
    state.chats = chats.chats;
    if (state.chats.length) {
      state.activeChat = state.chats[0];
      await loadChat(state.activeChat.id);
    } else {
      state.activeChat = null; state.messages = [];
    }
  } catch (err) {
    console.error(err);
    localStorage.removeItem('token');
    state.user = null;
  }
  render();
}

async function loadChat(id) {
  const data = await api(`/api/chats/${id}`);
  state.messages = data.messages;
}

async function sendMessage() {
  const input = document.getElementById('prompt');
  const text = input.value.trim();
  if (!text || state.generating) return;
  if (!state.activeChat) {
    const created = await api('/api/chats', { method: 'POST', body: { title: text.slice(0, 24) } });
    state.chats.unshift(created.chat);
    state.activeChat = created.chat;
  }
  state.messages.push({ role: 'user', content: text });
  state.generating = true;
  state.stopRequested = false;
  render();
  input.value = '';
  await api(`/api/chats/${state.activeChat.id}/messages`, { method: 'POST', body: { role: 'user', content: text } });
  const assistantReply = `Echo: ${text}\n\nThis is a polished demo response. The app is ready for an LLM backend connection.`;
  const placeholder = document.createElement('div');
  placeholder.className = 'bubble ai typing';
  placeholder.innerHTML = '<span></span><span></span><span></span>';
  document.getElementById('messages').appendChild(placeholder);
  setTimeout(async () => {
    if (state.stopRequested) {
      state.generating = false;
      render();
      return;
    }
    state.messages.push({ role: 'assistant', content: assistantReply });
    await api(`/api/chats/${state.activeChat.id}/messages`, { method: 'POST', body: { role: 'assistant', content: assistantReply } });
    state.generating = false;
    await init();
  }, 1100);
}

async function regenerateLast() {
  if (!state.activeChat || !state.messages.length) return;
  const lastUser = [...state.messages].reverse().find(msg => msg.role === 'user');
  if (!lastUser) return;
  const assistantMessages = state.messages.filter(msg => msg.role === 'assistant');
  if (assistantMessages.length) state.messages = state.messages.filter(msg => msg.role !== 'assistant' || msg.id);
  state.messages = state.messages.filter(msg => msg.role !== 'assistant');
  state.messages.push({ role: 'user', content: lastUser.content });
  state.generating = true;
  state.stopRequested = false;
  render();
  const assistantReply = `Regenerated: ${lastUser.content}\n\nThis is an enhanced demo response for the same prompt.`;
  setTimeout(async () => {
    if (state.stopRequested) {
      state.generating = false;
      render();
      return;
    }
    state.messages.push({ role: 'assistant', content: assistantReply });
    await api(`/api/chats/${state.activeChat.id}/messages`, { method: 'POST', body: { role: 'assistant', content: assistantReply } });
    state.generating = false;
    await init();
  }, 900);
}

function filteredChats() {
  return state.chats.filter(chat => chat.title.toLowerCase().includes(state.search.toLowerCase()));
}

function renderMarkdown(content) {
  const escaped = escapeHtml(content);
  const withCode = escaped.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  const withBold = withCode.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return withBold.replace(/\n/g, '<br />');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function api(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // stringify body when an object is provided (fix invalid JSON sent from client)
  const opts = { ...options };
  if (opts.body && typeof opts.body === 'object') {
    opts.body = JSON.stringify(opts.body);
  }
  const response = await fetch(path, { ...opts, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

init().catch(err => { console.error(err); });
