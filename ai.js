// ai.js — AI backend adapter for jellyfish pet
const fs = require('fs');
const path = require('path');

function getAISettings(settings) {
  return {
    backend: settings.aiBackend || 'claude-api',
    apiKey: settings.aiApiKey || '',
    model: settings.aiModel || 'claude-sonnet-4-6',
    endpoint: settings.aiEndpoint || 'https://api.anthropic.com',
    systemPrompt: settings.aiSystemPrompt || '你是一个桌面助手，帮用户分析文件内容。回答简洁结构化，用中文回复。'
  };
}

async function queryAI(settings, userPrompt, fileContent) {
  const ai = getAISettings(settings);
  const fullPrompt = fileContent
    ? `请分析以下文件内容，给出结构化摘要（不要复述原文，用简洁中文回答）：\n\n文件: ${userPrompt || ''}\n\n内容:\n${fileContent.slice(0, 6000)}`
    : userPrompt;

  if (ai.backend === 'claude-code') {
    return queryClaudeCode(fullPrompt);
  }
  if (ai.backend === 'openai') {
    return queryOpenAI(ai, fullPrompt);
  }
  return queryClaudeAPI(ai, fullPrompt);
}

async function queryClaudeAPI(ai, prompt) {
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
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
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

async function queryOpenAI(ai, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${ai.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ai.apiKey}`
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: ai.systemPrompt },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
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

module.exports = { queryAI, getAISettings };
