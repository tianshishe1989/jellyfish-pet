// ai.js — AI backend adapter for jellyfish pet
const fs = require('fs');
const path = require('path');

// --- Provider Presets ---
const PROVIDERS = {
  'claude-anthropic': {
    name: 'Claude (Anthropic)',
    backend: 'claude-api',
    endpoint: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    authType: 'x-api-key',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']
  },
  'openai': {
    name: 'OpenAI',
    backend: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    authType: 'bearer',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini']
  },
  'deepseek': {
    name: 'DeepSeek',
    backend: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    authType: 'bearer',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  'zhipu': {
    name: 'Zhipu GLM',
    backend: 'openai-compatible',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    authType: 'bearer',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air']
  },
  'kimi': {
    name: 'Kimi (Moonshot)',
    backend: 'openai-compatible',
    endpoint: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    authType: 'bearer',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  'minimax': {
    name: 'MiniMax',
    backend: 'openai-compatible',
    endpoint: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
    authType: 'bearer',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5']
  },
  'claude-code': {
    name: 'Claude Code (CLI)',
    backend: 'claude-code',
    endpoint: null,
    defaultModel: 'claude-sonnet-4-6',
    authType: 'none',
    models: []
  },
  'custom': {
    name: 'Custom (OpenAI Compatible)',
    backend: 'openai-compatible',
    endpoint: '',
    defaultModel: '',
    authType: 'bearer',
    models: []
  }
};

function getAISettings(settings) {
  const providerId = settings.aiProvider;

  // New provider system
  if (providerId && PROVIDERS[providerId]) {
    const preset = PROVIDERS[providerId];
    const overrides = (settings.aiProviderSettings && settings.aiProviderSettings[providerId]) || {};
    const isCustom = providerId === 'custom';
    return {
      providerId,
      backend: preset.backend,
      apiKey: overrides.apiKey || settings.aiApiKey || '',
      model: overrides.model || preset.defaultModel || settings.aiModel || '',
      endpoint: isCustom
        ? (overrides.endpoint || settings.aiEndpoint || '')
        : (preset.endpoint || ''),  // Lock built-in providers to preset endpoint
      authType: preset.authType,
      systemPrompt: settings.aiSystemPrompt || '你是一个桌面助手，帮用户分析文件内容。回答简洁结构化，用中文回复。'
    };
  }

  // @deprecated Legacy fallback — aiBackend is superseded by aiProvider
  // Remove this block when all users have migrated to the provider system
  return {
    providerId: null,
    backend: settings.aiBackend || 'claude-api',
    apiKey: settings.aiApiKey || '',
    model: settings.aiModel || 'claude-sonnet-4-6',
    endpoint: settings.aiEndpoint || 'https://api.anthropic.com',
    authType: settings.aiBackend === 'openai' ? 'bearer' : 'x-api-key',
    systemPrompt: settings.aiSystemPrompt || '你是一个桌面助手，帮用户分析文件内容。回答简洁结构化，用中文回复。'
  };
}

async function queryAI(settings, userPrompt, fileContent, history) {
  const ai = getAISettings(settings);
  const messagesHistory = Array.isArray(history) ? history : [];

  const fullPrompt = fileContent
    ? `请分析以下文件内容，给出结构化摘要（不要复述原文，用简洁中文回答）：\n\n文件: ${userPrompt || ''}\n\n内容:\n${fileContent.slice(0, 6000)}`
    : userPrompt;

  if (ai.backend === 'claude-code') {
    let promptWithHistory = fullPrompt;
    if (messagesHistory.length > 0) {
      const historyText = messagesHistory
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      promptWithHistory = `Previous conversation:\n${historyText}\n\nCurrent message: ${fullPrompt}`;
    }
    return queryClaudeCode(promptWithHistory);
  }
  if (ai.backend === 'openai-compatible' || ai.backend === 'openai') {
    return queryOpenAI(ai, fullPrompt, messagesHistory);
  }
  return queryClaudeAPI(ai, fullPrompt, messagesHistory);
}

async function queryClaudeAPI(ai, prompt, history) {
  const messages = [
    ...history,
    { role: 'user', content: prompt }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${ai.endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 2000,
        system: ai.systemPrompt,
        messages
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data.content || !Array.isArray(data.content)) {
      throw new Error(`Claude API returned unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('API request timed out');
    throw e;
  }
}

async function queryOpenAI(ai, prompt, history) {
  const messages = [
    { role: 'system', content: ai.systemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${ai.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ai.apiKey}`
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 2000,
        messages
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new Error(`OpenAI API returned unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return text;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('API request timed out');
    throw e;
  }
}

function queryClaudeCode(prompt) {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const tmpFile = path.join(require('os').tmpdir(), 'jellyfish-prompt-' + Date.now() + '.txt');
    try {
      fs.writeFileSync(tmpFile, prompt, 'utf-8');
    } catch (e) {
      reject(new Error('Failed to write temp file'));
      return;
    }

    const cmd = process.platform === 'win32'
      ? `type "${tmpFile}" | claude -p`
      : `cat "${tmpFile}" | claude -p`;

    exec(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (e) { /* */ }
      if (error) {
        reject(new Error(`Claude exited: ${(stderr || error.message).slice(0, 300)}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

module.exports = { queryAI, getAISettings, PROVIDERS };
