// chat.js — Jellyfish Chat Window
const convList = document.getElementById('conv-list');
const messagesEl = document.getElementById('messages');
const chatHeader = document.getElementById('chat-header');
const input = document.getElementById('input');
const btnSend = document.getElementById('btn-send');
const btnNew = document.getElementById('btn-new');

let conversations = [];
let activeId = null;
let loading = false;

// --- Markdown renderer (minimal) ---
function renderMarkdown(text) {
  let html = text;
  // Escape HTML first
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return '<pre><code>' + code.trim() + '</code></pre>';
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  // Unordered list items
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Paragraph breaks
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';
  // Clean empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  // Single newlines to <br>
  html = html.replace(/\n/g, '<br>');
  return html;
}

// --- Render ---
function renderConversations() {
  convList.innerHTML = '';
  conversations.forEach(c => {
    const div = document.createElement('div');
    div.className = 'conv-item' + (c.id === activeId ? ' active' : '');
    div.innerHTML = '<span class="title">' + escapeHtml(c.title || 'New Chat') + '</span><span class="del" data-id="' + c.id + '">&times;</span>';
    div.querySelector('.title').addEventListener('click', () => switchConversation(c.id));
    div.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    convList.appendChild(div);
  });
}

function renderMessages() {
  const conv = conversations.find(c => c.id === activeId);
  if (!conv || !conv.messages || conv.messages.length === 0) {
    messagesEl.innerHTML = '<div class="empty-state">新建对话开始聊天<br>拖文件到水母也可以在这里打开</div>';
    chatHeader.textContent = '选择或新建一个对话';
    return;
  }
  chatHeader.textContent = conv.title || 'Chat';
  messagesEl.innerHTML = '';
  conv.messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'msg ' + m.role;
    div.innerHTML = '<div class="bubble">' + (m.role === 'assistant' ? renderMarkdown(m.content) : escapeHtml(m.content)) + '</div>'
      + '<div class="meta">' + formatTime(m.timestamp) + (m.context ? ' · ' + escapeHtml(m.context.fileName || '') : '') + '</div>';
    messagesEl.appendChild(div);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, content, context) {
  const conv = conversations.find(c => c.id === activeId);
  if (!conv) return;
  conv.messages.push({
    id: crypto.randomUUID ? crypto.randomUUID() : 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    role, content,
    timestamp: new Date().toISOString(),
    context: context || undefined
  });
  conv.updatedAt = new Date().toISOString();
  // Auto-title from first user message
  if (role === 'user' && (!conv.title || conv.title === 'New Chat')) {
    conv.title = content.slice(0, 40);
  }
  renderMessages();
  renderConversations();
}

// --- Actions ---
async function switchConversation(id) {
  activeId = id;
  renderMessages();
  renderConversations();
  input.focus();
}

async function newConversation(title) {
  try {
    const result = await window.chatAPI.newConversation(title || 'New Chat');
    if (result.ok) {
      conversations = result.conversations;
      activeId = result.conversation.id;
      renderConversations();
      renderMessages();
      input.focus();
    }
  } catch (e) {
    console.error('Failed to create conversation:', e);
  }
}

async function deleteConversation(id) {
  try {
    await window.chatAPI.deleteConversation(id);
    conversations = conversations.filter(c => c.id !== id);
    if (activeId === id) {
      activeId = conversations.length > 0 ? conversations[0].id : null;
    }
    renderConversations();
    renderMessages();
  } catch (e) {
    console.error('Failed to delete conversation:', e);
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || loading) return;
  if (!activeId) {
    await newConversation(text.slice(0, 40));
  }
  if (!activeId) return;

  input.value = '';
  loading = true;
  btnSend.disabled = true;
  addMessage('user', text);

  // Add loading placeholder
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'msg assistant';
  loadingDiv.innerHTML = '<div class="bubble loading-dots">思考中</div>';
  loadingDiv.id = 'loading-msg';
  messagesEl.appendChild(loadingDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const resp = await window.chatAPI.submitMessage(activeId, text, null);
    const ld = document.getElementById('loading-msg');
    if (ld) ld.remove();

    if (resp.ok) {
      const conv = conversations.find(c => c.id === activeId);
      if (conv) {
        conv.messages = resp.conversation.messages;
        conv.updatedAt = resp.conversation.updatedAt;
      }
      renderMessages();
    } else {
      addMessage('assistant', 'Error: ' + resp.error);
    }
  } catch (e) {
    const ld = document.getElementById('loading-msg');
    if (ld) ld.remove();
    addMessage('assistant', '连接失败: ' + e.message);
  } finally {
    loading = false;
    btnSend.disabled = false;
    input.focus();
  }
}

// --- File analysis from jellyfish ---
if (window.chatAPI.onFileAnalysis) {
  window.chatAPI.onFileAnalysis(async (data) => {
    if (!activeId) {
      await newConversation(data.fileName || 'File Analysis');
    }
    if (!activeId) return;

    addMessage('user', '请分析这个文件: ' + (data.fileName || ''), { type: 'file', fileName: data.fileName });
    loading = true;
    btnSend.disabled = true;

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'msg assistant';
    loadingDiv.innerHTML = '<div class="bubble loading-dots">分析中</div>';
    loadingDiv.id = 'loading-msg';
    messagesEl.appendChild(loadingDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const resp = await window.chatAPI.submitMessage(activeId, data.fileName, { type: 'file', fileName: data.fileName, content: data.content });
      const ld = document.getElementById('loading-msg');
      if (ld) ld.remove();

      if (resp.ok) {
        const conv = conversations.find(c => c.id === activeId);
        if (conv) {
          conv.messages = resp.conversation.messages;
          conv.updatedAt = resp.conversation.updatedAt;
        }
        renderMessages();
      } else {
        addMessage('assistant', 'Error: ' + resp.error);
      }
    } catch (e) {
      const ld = document.getElementById('loading-msg');
      if (ld) ld.remove();
      addMessage('assistant', '分析失败: ' + e.message);
    } finally {
      loading = false;
      btnSend.disabled = false;
    }
  });
}

// --- Helpers ---
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

// --- Init ---
async function init() {
  try {
    const result = await window.chatAPI.loadHistory();
    if (result.ok) {
      conversations = result.conversations || [];
      activeId = result.activeConversationId || (conversations.length > 0 ? conversations[0].id : null);
      renderConversations();
      renderMessages();
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

// --- Title editing ---
chatHeader.addEventListener('dblclick', () => {
  if (!activeId) return;
  const conv = conversations.find(c => c.id === activeId);
  if (!conv) return;
  chatHeader.contentEditable = 'true';
  chatHeader.focus();
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(chatHeader);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
});

chatHeader.addEventListener('blur', async () => {
  chatHeader.contentEditable = 'false';
  if (!activeId) return;
  const newTitle = chatHeader.textContent.trim();
  if (newTitle) {
    try {
      await window.chatAPI.updateTitle(activeId, newTitle);
      const conv = conversations.find(c => c.id === activeId);
      if (conv) conv.title = newTitle;
      renderConversations();
    } catch (e) { /* ignore */ }
  }
});

chatHeader.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); chatHeader.blur(); }
});

btnSend.addEventListener('click', sendMessage);
btnNew.addEventListener('click', () => newConversation());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

init();
