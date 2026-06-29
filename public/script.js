const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

let conversationHistory = [];

function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;

  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTyping() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'typing';
  typingDiv.id = 'typing-indicator';
  typingDiv.textContent = 'AI is typing...';
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTyping() {
  const typing = document.getElementById('typing-indicator');
  if (typing) typing.remove();
}

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  addMessage('user', message);
  conversationHistory.push({ role: 'user', content: message });

  userInput.value = '';
  sendBtn.disabled = true;
  showTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory })
    });

    const data = await response.json();
    hideTyping();

    if (data.error) {
      addMessage('assistant', `Error: ${data.error}`);
    } else {
      addMessage('assistant', data.content);
      conversationHistory.push({ role: 'assistant', content: data.content });
    }
  } catch (error) {
    hideTyping();
    addMessage('assistant', `Error: ${error.message}`);
  }

  sendBtn.disabled = false;
  userInput.focus();
}

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

addMessage('assistant', 'Hello! I\'m your AI assistant. How can I help you today?');
