// jellyfish.js - pixel-art jellyfish state management + interactions
const container = document.getElementById('jellyfish');
const jelly = document.getElementById('jelly');
const head = document.getElementById('head');
const leftEye = document.getElementById('left-eye');
const rightEye = document.getElementById('right-eye');
const emojiEl = document.getElementById('state-emoji');
const bubble = document.getElementById('bubble');
let currentState = 'idle';
let stateTimeout = null;
let stateSeq = 0; // sequence counter to prevent race conditions
let lang = 'zh';
let aiQueryId = 0; // incrementing counter to prevent overlapping AI queries
let cachedSettings = {};

const texts = {
  zh: {
    thinking: '思考中...', executing: '执行中...', reading: '阅读中...',
    waiting: '等你选择...', feedMe: '嗯？给我吃的？', chewing: '嚼嚼...'
  },
  en: {
    thinking: 'Thinking...', executing: 'Working...', reading: 'Reading...',
    waiting: 'Waiting...', feedMe: 'Hmm? For me?', chewing: 'Nom nom...'
  }
};

function t(key) { return (texts[lang] && texts[lang][key]) || (texts.zh[key]) || ''; }

function getStateConfig() {
  return {
    idle:          { emoji: '',    cls: '',                    bubble: '',           duration: 0,     sound: null },
    thinking:      { emoji: '🤔', cls: 'state-thinking',       bubble: t('thinking'),  duration: 0,     sound: 'thinking' },
    responding:    { emoji: '💬', cls: '',                     bubble: '',           duration: 0,     sound: 'pop' },
    executing:     { emoji: '🔧', cls: 'state-executing',      bubble: t('executing'), duration: 0,     sound: 'pop' },
    reading:       { emoji: '📖', cls: 'state-reading',        bubble: t('reading'),   duration: 0,     sound: null },
    waiting_choice:{ emoji: '❓', cls: 'state-waiting_choice',  bubble: t('waiting'),   duration: 0,     sound: 'pop' },
    error:         { emoji: '😵', cls: 'state-error',          bubble: '',           duration: 5000,  sound: 'error' },
    done:          { emoji: '✨', cls: 'state-done',            bubble: '',           duration: 3000,  sound: 'done' }
  };
}

function setState(state, message) {
  if (state === currentState && !message) return;
  if (stateTimeout) { clearTimeout(stateTimeout); stateTimeout = null; }

  const seq = ++stateSeq;
  const config = getStateConfig()[state] || getStateConfig().idle;
  currentState = state;

  // Clear all state classes
  jelly.className = 'jelly-outer';
  if (container.classList.contains('locked')) jelly.classList.add('locked');
  if (container.classList.contains('drag-over')) jelly.classList.add('drag-over');
  if (config.cls) jelly.classList.add(config.cls);

  // Emoji
  emojiEl.textContent = config.emoji;
  emojiEl.className = 'state-emoji' + (config.emoji ? ' show' : '');

  // Bubble
  const bubbleText = message || config.bubble;
  bubble.textContent = bubbleText;
  bubble.className = 'speech-bubble' + (bubbleText ? ' show' : '');

  // Sound
  if (config.sound && typeof playSound === 'function') playSound(config.sound);

  // Error hue
  head.style.filter = (state === 'error') ? 'hue-rotate(-20deg) saturate(1.3)' : '';

  // Done particles
  if (state === 'done') spawnParticles();

  // Auto-recover (only if no newer state was set)
  if (config.duration > 0) {
    stateTimeout = setTimeout(() => {
      if (stateSeq === seq) setState('idle');
    }, config.duration);
  }
}

function spawnParticles() {
  const emojis = ['💛','🧡','✨','💫','⭐'];
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    p.style.left = (30 + Math.random() * 30) + 'px';
    p.style.top  = (-10 + Math.random() * 20) + 'px';
    p.style.animationDelay = Math.random() * 0.3 + 's';
    container.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
}

// === Auto blink ===
function scheduleBlink() {
  const delay = 2500 + Math.random() * 5000;
  setTimeout(() => {
    jelly.classList.add('blinking');
    setTimeout(() => jelly.classList.remove('blinking'), 200);
    scheduleBlink();
  }, delay);
}
scheduleBlink();

// === Drag (main process handles all coordinates) ===
let dragging = false;
let dragRafId = null;

jelly.addEventListener('mousedown', (e) => {
  if (container.classList.contains('locked')) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !el.closest('.head, .leg, .arm, .eye, .legs')) return;
  e.stopPropagation();
  dragging = true;
  if (window.jellyfishAPI) window.jellyfishAPI.dragStart();
  if (typeof playSound === 'function') playSound('click');
});

window.addEventListener('mousemove', () => {
  if (!dragging || !window.jellyfishAPI) return;
  if (!dragRafId) {
    dragRafId = requestAnimationFrame(() => {
      window.jellyfishAPI.dragMove();
      dragRafId = null;
    });
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (dragRafId) { cancelAnimationFrame(dragRafId); dragRafId = null; }
  if (window.jellyfishAPI) window.jellyfishAPI.dragEnd();
});

// === File drop ===
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) {
    container.classList.add('drag-over');
    jelly.classList.add('drag-over');
    setState('idle', t('feedMe'));
  }
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    container.classList.remove('drag-over');
    jelly.classList.remove('drag-over');
    bubble.textContent = '';
    bubble.className = 'speech-bubble';
  }
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  container.classList.remove('drag-over');
  jelly.classList.remove('drag-over');
  if (typeof playSound === 'function') playSound('drop');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    const name = file.name;
    // Reject files larger than 1MB
    if (file.size > 1024 * 1024) {
      setState('error', '文件太大了!');
      setTimeout(() => setState('idle'), 3000);
      return;
    }
    setState('done', `${t('chewing')} ${name}`);
    // Cancel any previous AI query
    const myQuery = ++aiQueryId;
    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result;
      setTimeout(async () => {
        if (myQuery !== aiQueryId) return; // cancelled by newer drop
        // Chat mode: send to chat window
        if (cachedSettings.aiUseChat && window.jellyfishAPI.sendFileToChat) {
          window.jellyfishAPI.sendFileToChat({ fileName: name, content: content });
          setState('done', '已发送到聊天窗口');
          setTimeout(() => setState('idle'), 2500);
          return;
        }

        // Legacy: local panel analysis
        setState('thinking', '消化中...');
        panel.classList.add('show');
        try {
          const resp = await window.jellyfishAPI.aiQuery({ prompt: name, content: content });
          if (myQuery !== aiQueryId) return;
          if (resp.ok) {
            updatePanel({ taskName: name, aiResponse: resp.text });
            setState('done', '解析完成!');
          } else {
            updatePanel({ taskName: name, aiResponse: 'Error: ' + resp.error });
            setState('error', 'AI 出错');
          }
        } catch (e) {
          if (myQuery !== aiQueryId) return;
          updatePanel({ taskName: name, aiResponse: 'Error: ' + e.message });
          setState('error', '连接失败');
        }
      }, 2500);
    };
    reader.readAsText(file);
  }
});

// === Click bounce ===
jelly.addEventListener('click', (e) => {
  if (dragging) return;
  const emojis = ['💛','🧡','✨','💫','⭐'];
  const p = document.createElement('span');
  p.className = 'particle';
  p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
  const rect = jelly.getBoundingClientRect();
  p.style.left = (e.clientX - rect.left - 8) + 'px';
  p.style.top  = (e.clientY - rect.top - 8) + 'px';
  container.appendChild(p);
  setTimeout(() => p.remove(), 1000);

  jelly.style.animation = 'none';
  jelly.offsetHeight;
  jelly.style.animation = '';
});

// === Double-click → Quick Ask ===
jelly.addEventListener('dblclick', (e) => {
  if (dragging || container.classList.contains('locked')) return;
  if (window.jellyfishAPI.openQuickAsk) window.jellyfishAPI.openQuickAsk();
});

// === Right-click → Open Chat ===
jelly.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (container.classList.contains('locked')) return;
  if (window.jellyfishAPI.openChat) window.jellyfishAPI.openChat();
});

// === Skin ===
const skinCache = {};
async function loadSkin(skinId) {
  if (skinCache[skinId]) return skinCache[skinId];
  try {
    // Try built-in skins first
    let resp = await fetch(`skins/${skinId}.json`);
    if (resp.ok) {
      const skin = await resp.json();
      skinCache[skinId] = skin;
      return skin;
    }
  } catch (e) { /* try custom */ }
  // Fallback to default
  if (skinId !== 'default-blue') return loadSkin('default-blue');
  return null;
}
async function applySkin(skinId) {
  const skin = await loadSkin(skinId);
  if (!skin) return;
  for (const [key, val] of Object.entries(skin.colors)) {
    document.documentElement.style.setProperty(`--${key}`, val);
  }
}

// === Init IPC ===
// === Expand Panel ===
const panel = document.getElementById('expand-panel');
const panelTask = document.getElementById('panel-task');
const panelPct = document.getElementById('panel-pct');
const panelBar = document.getElementById('panel-bar');
const panelSpeed = document.getElementById('panel-speed');
const panelPin = document.getElementById('panel-pin');
let panelHoverTimer = null;
let panelLeaveTimer = null;
let panelPinned = false;
let panelData = {};

function updatePanel(data) {
  if (data.taskName !== undefined) { panelData.taskName = data.taskName; panelTask.textContent = data.taskName || ''; }
  if (data.progress !== undefined) {
    panelData.progress = data.progress;
    panelPct.textContent = data.progress + '%';
    panelPct.style.display = 'block';
    panelBar.style.width = data.progress + '%';
  } else {
    panelPct.style.display = 'none';
    panelBar.style.width = '0%';
  }
  if (data.speed !== undefined) { panelData.speed = data.speed; panelSpeed.textContent = data.speed || ''; }
  else { panelSpeed.textContent = ''; }
  if (data.aiResponse !== undefined) {
    const el = document.getElementById('panel-ai');
    if (el) el.textContent = data.aiResponse;
  }
}

function showPanel() {
  if (panelHoverTimer) { clearTimeout(panelHoverTimer); panelHoverTimer = null; }
  if (panelLeaveTimer) { clearTimeout(panelLeaveTimer); panelLeaveTimer = null; }
  if (panel.classList.contains('show')) return;
  panel.classList.add('show');
}

function hidePanel() {
  if (panelPinned) return;
  if (!panel.classList.contains('show')) return;
  panel.classList.remove('show');
}

function startLeaveTimer() {
  if (panelPinned) return;
  if (panelLeaveTimer) clearTimeout(panelLeaveTimer);
  panelLeaveTimer = setTimeout(hidePanel, 400);
}

jelly.addEventListener('mouseenter', () => {
  if (panelLeaveTimer) { clearTimeout(panelLeaveTimer); panelLeaveTimer = null; }
  if (!panel.classList.contains('show')) {
    if (panelHoverTimer) clearTimeout(panelHoverTimer);
    panelHoverTimer = setTimeout(showPanel, 1000);
  }
});

jelly.addEventListener('mouseleave', () => {
  if (panelHoverTimer) { clearTimeout(panelHoverTimer); panelHoverTimer = null; }
  startLeaveTimer();
});

panel.addEventListener('mouseenter', () => {
  if (panelLeaveTimer) { clearTimeout(panelLeaveTimer); panelLeaveTimer = null; }
});

panel.addEventListener('mouseleave', () => {
  startLeaveTimer();
});

const panelCopy = document.getElementById('panel-copy');
panelCopy.addEventListener('click', async (e) => {
  e.stopPropagation();
  const aiEl = document.getElementById('panel-ai');
  if (aiEl && aiEl.textContent) {
    try {
      await navigator.clipboard.writeText(aiEl.textContent);
      panelCopy.textContent = '✅';
      panelCopy.classList.add('copied');
      setTimeout(() => {
        panelCopy.textContent = '📋';
        panelCopy.classList.remove('copied');
      }, 1500);
    } catch (err) {
      panelCopy.textContent = '❌';
      setTimeout(() => { panelCopy.textContent = '📋'; }, 1500);
    }
  }
});

panelPin.addEventListener('click', (e) => {
  e.stopPropagation();
  panelPinned = !panelPinned;
  panelPin.classList.toggle('active', panelPinned);
  panel.classList.toggle('pinned', panelPinned);
});

console.log('[jellyfish] Pixel-art jellyfish ready');

if (window.jellyfishAPI) {
  window.jellyfishAPI.onStateChange((data) => {
    setState(data.state, data.message);
    updatePanel(data);
  });

  window.jellyfishAPI.onSkinChange(async (data) => {
    await applySkin(data.skin);
  });

  window.jellyfishAPI.onSettingsChanged((data) => {
    Object.assign(cachedSettings, data);
    if (data.locked !== undefined) {
      container.classList.toggle('locked', data.locked);
      jelly.classList.toggle('locked', data.locked);
    }
    if (data.language) {
      lang = data.language;
    }
  });

  window.jellyfishAPI.onFileDrop(async (data) => {
    setState('done', data.message || `嚼嚼... ${data.name}`);
    if (data.triggerAI) {
      setTimeout(async () => {
        // Chat mode: send to chat window
        if (cachedSettings.aiUseChat && window.jellyfishAPI.sendFileToChat) {
          window.jellyfishAPI.sendFileToChat({ fileName: data.name, filePath: data.path });
          setState('done', '已发送到聊天窗口');
          setTimeout(() => setState('idle'), 2500);
          return;
        }
        // Legacy: local panel analysis
        setState('thinking', '消化中...');
        panel.classList.add('show');
        try {
          const resp = await window.jellyfishAPI.aiQuery({ prompt: data.name, filePath: data.path });
          if (resp.ok) {
            updatePanel({ taskName: data.name, aiResponse: resp.text });
            setState('done', '解析完成!');
          } else {
            updatePanel({ taskName: data.name, aiResponse: 'Error: ' + resp.error });
            setState('error', 'AI 出错');
          }
        } catch (e) {
          updatePanel({ taskName: data.name, aiResponse: 'Error: ' + e.message });
          setState('error', '连接失败');
        }
      }, 2500);
    } else {
      setTimeout(() => setState('idle'), 2500);
    }
  });

  window.jellyfishAPI.onEdgeState((data) => {
    if (data.hidden) {
      document.body.classList.add('edge-hidden');
      document.body.setAttribute('data-edge', data.edge || '');
      document.body.setAttribute('data-strip-color', data.color || 'blue');
      if (data.hover) document.body.classList.add('edge-hover');
      else document.body.classList.remove('edge-hover');
      if (data.flash) {
        document.body.classList.add('edge-flash');
        setTimeout(() => document.body.classList.remove('edge-flash'), 1500);
      }
    } else {
      document.body.classList.remove('edge-hidden', 'edge-hover');
      document.body.removeAttribute('data-edge');
    }
  });

  window.jellyfishAPI.getSettings().then(async (s) => {
    cachedSettings = s;
    if (s.skin) await applySkin(s.skin);
    if (s.locked) {
      container.classList.add('locked');
      jelly.classList.add('locked');
    }
    if (s.language) {
      lang = s.language;
    }
  });
}
