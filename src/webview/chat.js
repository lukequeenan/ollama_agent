/**
 * Webview client-side chat interface
 */

// Modern VS Code webview API (Acquire from globally available vscode object)
const vscode = acquireVsCodeApi();

// State
let conversationHistory = [];
let isLoading = false;
let connectionState = 'disconnected'; // 'connected', 'disconnected', 'error'
let lastSelectedText = '';

// DOM Elements
const messagesArea = document.getElementById('messages-area');
const inputField = document.getElementById('input-field');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const contextBadge = document.getElementById('context-badge');
const errorMessage = document.getElementById('error-message');

/**
 * Initialize the chat interface
 */
function initialize() {
    setupEventListeners();
    notifyExtensionReady();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    sendBtn.addEventListener('click', sendMessage);
    clearBtn.addEventListener('click', clearHistory);
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Listen for messages from the extension
    window.addEventListener('message', (event) => {
        const message = event.data;
        handleExtensionMessage(message);
    });
}

/**
 * Send payload to extension
 */
function postMessage(message) {
    vscode.postMessage(message);
}

/**
 * Notify extension that webview is ready
 */
function notifyExtensionReady() {
    postMessage({ type: 'webviewReady' });
}

/**
 * Handle messages from the extension
 */
function handleExtensionMessage(message) {
    switch (message.type) {
        case 'addMessage':
            handleAddMessage(message.payload);
            break;
        case 'responseChunk':
            handleResponseChunk(message.payload);
            break;
        case 'loadingState':
            handleLoadingState(message.payload);
            break;
        case 'connectionState':
            handleConnectionState(message.payload);
            break;
        case 'error':
            handleError(message.payload);
            break;
        case 'historyCleared':
            handleHistoryCleared();
            break;
        case 'selectedText':
            handleSelectedText(message.payload);
            break;
    }
}

/**
 * Handle new message from extension
 */
function handleAddMessage(payload) {
    const { message } = payload;
    conversationHistory.push(message);
    renderMessage(message);
}

/**
 * Handle response chunk (streaming)
 */
function handleResponseChunk(payload) {
    const { messageId, chunk } = payload;

    // Find and update the assistant message
    const message = conversationHistory.find((m) => m.id === messageId);
    if (message) {
        message.content += chunk;
        updateMessageDisplay(messageId);
    }
}

/**
 * Handle loading state change
 */
function handleLoadingState(payload) {
    const { loading } = payload;
    isLoading = loading;
    inputField.disabled = loading;
    sendBtn.disabled = loading;

    if (loading) {
        sendBtn.innerHTML = '<span class="spinner"></span>';
    } else {
        sendBtn.innerHTML = '<span>→</span>';
    }
}

/**
 * Handle connection state change
 */
function handleConnectionState(payload) {
    const { state } = payload;
    connectionState = state;

    statusIndicator.className = `status-dot ${state}`;

    const statusMap = {
        connected: '🟢 Connected',
        disconnected: '🟡 Disconnected',
        error: '🔴 Connection Error',
    };

    statusText.textContent = statusMap[state] || state;

    if (state !== 'connected') {
        inputField.disabled = true;
        sendBtn.disabled = true;
    } else if (!isLoading) {
        inputField.disabled = false;
        sendBtn.disabled = false;
    }
}

/**
 * Handle error message
 */
function handleError(payload) {
    const { message } = payload;
    showError(message);
    isLoading = false;
    inputField.disabled = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span>→</span>';
}

/**
 * Handle history cleared
 */
function handleHistoryCleared() {
    conversationHistory = [];
    clearMessagesDisplay();
}

/**
 * Handle selected text update from extension
 */
function handleSelectedText(payload) {
    const { text } = payload;
    lastSelectedText = text;

    if (text && text.trim()) {
        contextBadge.style.display = 'block';
    } else {
        contextBadge.style.display = 'none';
    }
}

/**
 * Send message to extension
 */
function sendMessage() {
    const message = inputField.value.trim();

    if (!message || isLoading || connectionState !== 'connected') {
        return;
    }

    clearError();
    inputField.value = '';

    postMessage({
        type: 'userMessage',
        payload: {
            message,
            selectedText: lastSelectedText || undefined,
        },
    });
}

/**
 * Clear conversation history
 */
function clearHistory() {
    if (conversationHistory.length === 0) {
        return;
    }

    const confirm = window.confirm('Clear all messages? This cannot be undone.');
    if (confirm) {
        postMessage({ type: 'clearHistory' });
    }
}

/**
 * Render a message in the chat area
 */
function renderMessage(message) {
    // Clear welcome message if first message
    if (conversationHistory.length === 1) {
        clearMessagesDisplay();
    }

    const messageEl = createMessageElement(message);
    messagesArea.appendChild(messageEl);
    scrollToBottom();
}

/**
 * Create a message element
 */
function createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    div.id = `message-${message.id}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = message.content;

    div.appendChild(contentDiv);

    // Add context badge if applicable
    if (message.context?.selectedText) {
        const contextDiv = document.createElement('div');
        contextDiv.className = 'message-context';
        contextDiv.textContent = `📄 With selected text`;
        div.appendChild(contextDiv);
    }

    return div;
}

/**
 * Update message display (for streaming)
 */
function updateMessageDisplay(messageId) {
    const messageEl = document.getElementById(`message-${messageId}`);
    if (messageEl) {
        const contentDiv = messageEl.querySelector('.message-content');
        const message = conversationHistory.find((m) => m.id === messageId);
        if (contentDiv && message) {
            contentDiv.textContent = message.content;
        }
    }
}

/**
 * Clear messages display and show welcome
 */
function clearMessagesDisplay() {
    messagesArea.innerHTML = `
        <div class="welcome-message">
            <h3>Welcome to Ollama Chat</h3>
            <p>Start a conversation with your local AI model</p>
            <div class="connection-status">
                <span id="status-indicator" class="status-dot ${connectionState}"></span>
                <span id="status-text">${getStatusText()}</span>
            </div>
        </div>
    `;

    // Re-attach event listeners to new status indicator
    const newStatusIndicator = document.getElementById('status-indicator');
    const newStatusText = document.getElementById('status-text');
    if (newStatusIndicator) statusIndicator = newStatusIndicator;
    if (newStatusText) statusText = newStatusText;
}

/**
 * Get status text based on connection state
 */
function getStatusText() {
    const statusMap = {
        connected: '🟢 Connected',
        disconnected: '🟡 Disconnected',
        error: '🔴 Connection Error',
    };
    return statusMap[connectionState] || connectionState;
}

/**
 * Scroll to bottom of messages area
 */
function scrollToBottom() {
    setTimeout(() => {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }, 0);
}

/**
 * Show error message
 */
function showError(message) {
    errorMessage.textContent = message || 'An error occurred';
    errorMessage.style.display = 'block';
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}

/**
 * Clear error message
 */
function clearError() {
    errorMessage.style.display = 'none';
}

// Initialize on page load
initialize();
