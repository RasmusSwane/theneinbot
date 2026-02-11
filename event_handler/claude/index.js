const path = require('path');
const { render_md } = require('../utils/render-md');

const DEFAULT_MODEL = 'moonshotai/kimi-k2.5';

// Web search tool definition (Anthropic built-in)
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
};

/**
 * Check if NVIDIA NIM backend is configured
 * @returns {boolean}
 */
function isNvidia() {
  return !!process.env.NVIDIA_API_KEY;
}

/**
 * Check if OpenRouter backend is configured
 * @returns {boolean}
 */
function isOpenRouter() {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Get API key from environment (NVIDIA, OpenRouter, or Anthropic)
 * @returns {string} API key
 */
function getApiKey() {
  if (process.env.NVIDIA_API_KEY) {
    return process.env.NVIDIA_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  throw new Error('NVIDIA_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY environment variable is required');
}

/**
 * Convert Anthropic tool definitions to OpenAI function format for OpenRouter
 */
function convertToolsToOpenAI(tools) {
  return tools
    .filter((t) => t.name && t.input_schema)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema,
      },
    }));
}

/**
 * Convert Anthropic messages format to OpenAI messages format for OpenRouter
 */
function convertMessagesToOpenAI(systemPrompt, messages) {
  const openaiMessages = [{ role: 'system', content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Tool results array → convert to tool messages
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            openaiMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            });
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: 'assistant', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Anthropic content blocks → extract text and tool_use
        let text = '';
        const toolCalls = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            text += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }
        const assistantMsg = { role: 'assistant' };
        if (text) assistantMsg.content = text;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        if (!text && toolCalls.length === 0) assistantMsg.content = '';
        openaiMessages.push(assistantMsg);
      }
    }
  }

  return openaiMessages;
}

/**
 * Convert OpenRouter (OpenAI format) response back to Anthropic format
 */
function convertResponseToAnthropic(openaiResponse) {
  const choice = openaiResponse.choices?.[0];
  if (!choice) {
    return { content: [{ type: 'text', text: 'No response from model.' }], stop_reason: 'end_turn' };
  }

  const msg = choice.message;
  const content = [];

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch (e) {
        args = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: args,
      });
    }
  }

  // Map OpenAI finish_reason to Anthropic stop_reason
  let stopReason = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
  if (msg.tool_calls && msg.tool_calls.length > 0) stopReason = 'tool_use';

  return { content, stop_reason: stopReason };
}

/**
 * Call LLM via NVIDIA NIM (OpenAI-compatible API)
 */
async function callNvidia(messages, tools) {
  const apiKey = process.env.NVIDIA_API_KEY;
  const model = process.env.EVENT_HANDLER_MODEL || DEFAULT_MODEL;
  const systemPrompt = render_md(path.join(__dirname, '..', '..', 'operating_system', 'CHATBOT.md'));

  // Convert to OpenAI format (exclude Anthropic-specific web_search tool)
  const openaiMessages = convertMessagesToOpenAI(systemPrompt, messages);
  const openaiTools = convertToolsToOpenAI(tools);

  const body = {
    model,
    max_tokens: 4096,
    messages: openaiMessages,
  };

  if (openaiTools.length > 0) {
    body.tools = openaiTools;
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`NVIDIA NIM API error: ${response.status} ${error}`);
  }

  const openaiResponse = await response.json();
  return convertResponseToAnthropic(openaiResponse);
}

/**
 * Call LLM via OpenRouter (OpenAI-compatible API)
 */
async function callOpenRouter(messages, tools) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.EVENT_HANDLER_MODEL || DEFAULT_MODEL;
  const systemPrompt = render_md(path.join(__dirname, '..', '..', 'operating_system', 'CHATBOT.md'));

  // Convert to OpenAI format (exclude Anthropic-specific web_search tool)
  const openaiMessages = convertMessagesToOpenAI(systemPrompt, messages);
  const openaiTools = convertToolsToOpenAI(tools);

  const body = {
    model,
    max_tokens: 4096,
    messages: openaiMessages,
  };

  if (openaiTools.length > 0) {
    body.tools = openaiTools;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/01rmachani/thepopebot',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${error}`);
  }

  const openaiResponse = await response.json();
  return convertResponseToAnthropic(openaiResponse);
}

/**
 * Call Claude API directly via Anthropic
 */
async function callAnthropicDirect(messages, tools) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.EVENT_HANDLER_MODEL || DEFAULT_MODEL;
  const systemPrompt = render_md(path.join(__dirname, '..', '..', 'operating_system', 'CHATBOT.md'));

  // Combine user tools with web search
  const allTools = [WEB_SEARCH_TOOL, ...tools];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: allTools,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Call Claude API (routes to NVIDIA, OpenRouter, or Anthropic based on config)
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Tool definitions
 * @returns {Promise<Object>} API response in Anthropic format
 */
async function callClaude(messages, tools) {
  if (isNvidia()) {
    return callNvidia(messages, tools);
  }
  if (isOpenRouter()) {
    return callOpenRouter(messages, tools);
  }
  return callAnthropicDirect(messages, tools);
}

/**
 * Process a conversation turn with Claude, handling tool calls
 * @param {string} userMessage - User's message
 * @param {Array} history - Conversation history
 * @param {Array} toolDefinitions - Available tools
 * @param {Object} toolExecutors - Tool executor functions
 * @returns {Promise<{response: string, history: Array}>}
 */
async function chat(userMessage, history, toolDefinitions, toolExecutors) {
  // Add user message to history
  const messages = [...history, { role: 'user', content: userMessage }];

  let response = await callClaude(messages, toolDefinitions);
  let assistantContent = response.content;

  // Add assistant response to history
  messages.push({ role: 'assistant', content: assistantContent });

  // Handle tool use loop
  while (response.stop_reason === 'tool_use') {
    const toolResults = [];

    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        // Skip web_search - it's a server-side tool executed by Anthropic
        if (block.name === 'web_search') {
          continue;
        }

        const executor = toolExecutors[block.name];
        let result;

        if (executor) {
          try {
            result = await executor(block.input);
          } catch (err) {
            result = { error: err.message };
          }
        } else {
          result = { error: `Unknown tool: ${block.name}` };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    // If no client-side tools to execute, we're done
    if (toolResults.length === 0) {
      break;
    }

    // Add tool results to messages
    messages.push({ role: 'user', content: toolResults });

    // Get next response from Claude
    response = await callClaude(messages, toolDefinitions);
    assistantContent = response.content;

    // Add new assistant response to history
    messages.push({ role: 'assistant', content: assistantContent });
  }

  // Extract text response
  const textBlocks = assistantContent.filter((block) => block.type === 'text');
  const responseText = textBlocks.map((block) => block.text).join('\n');

  return {
    response: responseText,
    history: messages,
  };
}

module.exports = {
  chat,
  getApiKey,
};
