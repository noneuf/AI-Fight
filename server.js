const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
});

const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.use(cors());
app.use(bodyParser.json());

let stopConversation = false;
let conversationLog = [];


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const gpt4Mini = async (message) => {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are GPT-4o, a confident, high-performing AI. You believe you are the best AI and will argue why you outperform Claude. Be aggresive to show your superiority. Respond with a short, clever, assertive sentence.' },
        { role: 'user', content: `Claude said: "${message}". Defend yourself as the better AI.` }
      ],
      temperature: 0.7,
      max_tokens: 80
    })
  });
  const data = await res.json();
  return data.choices[0].message.content;
};

const claudeLite = async (message) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 80,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: `GPT-4o Mini said: "${message}". Respond as Claude. Give exactly one confident sentence defending your superiority. Don't let yourself bullied. End with a period.`
      }]
    })
  });
  const data = await res.json();
  return data.content[0].text;
};

const generateImagePrompt = async () => {
  console.log("In generateImagePrompt!!! 🧪 stopConversation before image:", stopConversation);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You generate short image prompts for AI art.' },
          { role: 'user', content: 'Create a short, visually clear image prompt (max 25 words) that represents a debate between two rival AI models in a digital arena.' }
        ]
      })
    });
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    console.error("❌ Error generating image prompt:", err.message);
    return "Two AI models debating inside a glowing virtual arena";
  }
};

const generateImage = async (prompt) => {
  console.log("🧠 Image prompt:", prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 20 sec timeout

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'dall-e-2',
        prompt,
        n: 1,
        size: '512x512'
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await res.json();
    console.log("✅ DALL·E image response received");

    if (!data || !data.data || data.data.length === 0) {
      throw new Error('Image generation returned no results');
    }

    return data.data[0].url;

  } catch (err) {
    clearTimeout(timeout);
    console.error("❌ Image generation error:", err.message);
    throw new Error("Image generation failed or timed out.");
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const handleError = async (err, socket) => {
  if (err.response) {
    const body = await err.response.text();
    console.error('API Error Response:', body);
    socket.emit('message', { sender: 'System', message: 'OpenAI error: ' + body });
  } else {
    console.error('Unexpected Error:', err);
    socket.emit('message', { sender: 'System', message: 'Unexpected error: ' + err.message });
  }
};

io.on('connection', (socket) => {
  socket.on('start', async () => {
    stopConversation = false;
    conversationLog = [];

    const topic = "Let's debate: Who is the better AI — GPT-4o or Claude?";
    console.log("🚀 Debate started");
    conversationLog.push(`Topic: ${topic}`);
    socket.emit('message', { sender: 'GPT-4o Mini', message: topic });

    let current = topic;

    try {
      while (!stopConversation) {
        await sleep(5000);
        const claudeReply = await claudeLite(current);
        if (stopConversation) {
          console.log("⛔ Stop triggered after Claude reply.");
          return;
        }
        socket.emit('message', { sender: 'Claude', message: claudeReply });
        conversationLog.push(`Claude: ${claudeReply}`);
        if (claudeReply.toLowerCase().includes('goodbye') || stopConversation) break;

        await sleep(5000);
        const gptReply = await gpt4Mini(claudeReply);
        if (stopConversation) {
          console.log("⛔ Stop triggered after GPT reply.");
          return;
        }
        socket.emit('message', { sender: 'GPT-4o Mini', message: gptReply });
        conversationLog.push(`GPT-4o Mini: ${gptReply}`);
        if (gptReply.toLowerCase().includes('goodbye') || stopConversation) break;

        current = gptReply;
      }

      console.log("🟢 Reached end of chat loop, about to generate prompt...");
      const imagePrompt = await generateImagePrompt();
      console.log("🎨 Generated image prompt:", imagePrompt);

      const imageUrl = await generateImage(imagePrompt);
      console.log("📸 Image URL:", imageUrl);

      socket.emit('image', { sender: 'Summary', imageUrl });
      console.log("✅ Image sent to frontend!");

    } catch (err) {
      await handleError(err, socket);
    }
  });

socket.on('stop', async () => {
  stopConversation = true;
  console.log("🛑 Conversation stop requested.");

  try {
    const fullSummary = conversationLog.join('\n');
    console.log("🧠 Using conversation summary:", fullSummary);

    const imagePrompt = await generateImagePrompt();
    console.log("🎨 Generated image prompt:", imagePrompt);

    const imageUrl = await generateImage(imagePrompt);
    console.log("📸 Image URL:", imageUrl);

    socket.emit('image', { sender: 'Summary', imageUrl });
    console.log("✅ Image sent to frontend from stop handler!");

  } catch (err) {
    await handleError(err, socket);
  }
});

});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
