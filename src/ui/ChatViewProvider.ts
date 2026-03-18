/**
 * Chat View Provider - manages the webview and communication with extension
 */

import * as vscode from 'vscode';
import { ChatStateManager } from '../state/ChatStateManager';
import { OllamaClient } from '../ollama/OllamaClient';
import { OllamaConfigManager } from '../ollama/OllamaConfig';
import { WebviewMessage, ExtensionMessage, FileReference } from '../types/chat';
import { WorkspaceFileProvider } from '../workspace/WorkspaceFileProvider';
import { FileReader } from '../workspace/FileReader';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ollama-chat-panel';
  private static readonly DEBUG = false; // Set to true for development logging

  private view?: vscode.WebviewView;
  private stateManager?: ChatStateManager;
  private client?: OllamaClient;
  private extensionUri: vscode.Uri;
  private connectionState: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private availableModels: string[] = [];

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Resolve the webview view
   */
  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    // Configure webview
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    // Load HTML
    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    // Initialize state and client
    const config = OllamaConfigManager.getConfig();
    this.stateManager = new ChatStateManager(config);
    this.client = new OllamaClient(config);

    // Check connection
    await this.checkConnection();

    // Listen for messages from webview
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleWebviewMessage(message),
      undefined,
      []
    );

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ollama')) {
        this.updateConfiguration();
      }
    });
  }

  /**
   * Check Ollama server connection
   */
  private async checkConnection() {
    try {
      ChatViewProvider.log('Checking connection to Ollama...');
      if (this.client && (await this.client.isAvailable())) {
        // Fetch available models
        try {
          const models = await this.client.getModels();
          this.availableModels = models.map((m) => m.name);
          ChatViewProvider.log('✓ Connected, models available:', this.availableModels.length);
        } catch (e) {
          ChatViewProvider.log('Warning: Could not fetch models');
        }
        this.connectionState = 'connected';
      } else {
        ChatViewProvider.log('✗ Connection failed');
        this.connectionState = 'disconnected';
      }
    } catch (error) {
      ChatViewProvider.log('Connection error:', error);
      this.connectionState = 'error';
    }

    this.sendMessage({
      type: 'connectionState',
      payload: {
        state: this.connectionState,
        models: this.availableModels
      },
    });
  }

  /**
   * Debug logging (only when DEBUG is true)
   */
  private static log(...args: unknown[]) {
    if (ChatViewProvider.DEBUG) {
      console.log('[OllamaChat]', ...args);
    }
  }

  /**
   * Handle messages from webview
   */
  private async handleWebviewMessage(message: WebviewMessage) {
    switch (message.type) {
      case 'userMessage':
        await this.handleUserMessage(message.payload);
        break;
      case 'clearHistory':
        this.handleClearHistory();
        break;
      case 'selectModel':
        await this.handleSelectModel((message.payload as { model?: string } | undefined)?.model);
        break;
      case 'searchFiles':
      case 'fileSearch':
        await this.handleSearchFiles((message.payload as { query: string }).query);
        break;
      default:
        console.warn('Unknown message type:', message);
    }
  }

  /**
   * Handle user message
   */
  private async handleUserMessage(payload: { message: string; selectedText?: string }) {
    ChatViewProvider.log('User message:', payload.message.substring(0, 50));

    if (!this.stateManager || !this.client || this.connectionState !== 'connected') {
      const errorMsg = this.connectionState === 'error'
        ? 'Connection error: Please restart the extension or check Ollama settings.'
        : 'Ollama is not connected. Please check your connection settings.';

      this.sendMessage({
        type: 'error',
        payload: { message: errorMsg },
      });
      return;
    }

    try {
      // Parse and extract file references from message
      const { cleanMessage, fileReferences, fileContents } = await this.extractFileReferences(payload.message);

      // Add user message to state with file references and contents
      const userMessage = this.stateManager.addMessage('user', cleanMessage, {
        selectedText: payload.selectedText,
      }, fileReferences.length > 0 ? fileReferences : undefined, fileContents.length > 0 ? fileContents : undefined);

      // Send user message to webview
      this.sendMessage({
        type: 'addMessage',
        payload: { message: userMessage },
      });

      // Set loading state
      this.stateManager.setLoading(true);
      this.sendMessage({
        type: 'loadingState',
        payload: { loading: true },
      });

      // Build prompt with conversation history
      const prompt = this.stateManager.getConversationPrompt();
      const model = this.stateManager.getState().currentModel;
      ChatViewProvider.log('Using model:', model, 'File references:', fileReferences.length);

      // Get response from Ollama
      let fullResponse = '';
      const assistantMessage = this.stateManager.addMessage('assistant', '', {});

      try {
        fullResponse = await this.client.generateResponseWithTools(
          prompt,
          model,
          (chunk: string) => {
            ChatViewProvider.log('Chunk received:', chunk.length, 'chars');
            // Stream chunks
            this.stateManager!.updateMessage(assistantMessage.id, fullResponse + chunk);
            this.sendMessage({
              type: 'responseChunk',
              payload: {
                messageId: assistantMessage.id,
                chunk,
              },
            });
          },
          fileReferences.length > 0 ? fileReferences : undefined
        );
        ChatViewProvider.log('Response complete');
      } catch (_streamError) {
        // If streaming fails, retry without streaming
        ChatViewProvider.log('Streaming failed, retrying...');
        fullResponse = await this.client.generateResponseWithTools(
          prompt,
          model,
          undefined,
          fileReferences.length > 0 ? fileReferences : undefined
        );
        this.stateManager!.updateMessage(assistantMessage.id, fullResponse);
      }

      // Send final message
      this.sendMessage({
        type: 'addMessage',
        payload: { message: { ...assistantMessage, content: fullResponse } },
      });
    } catch (error) {
      ChatViewProvider.log('Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendMessage({
        type: 'error',
        payload: { message: `Failed to get response: ${errorMessage}` },
      });
    } finally {
      // Clear loading state
      this.stateManager!.setLoading(false);
      this.sendMessage({
        type: 'loadingState',
        payload: { loading: false },
      });
    }
  }

  /**
   * Handle clear history request
   */
  private handleClearHistory() {
    if (this.stateManager) {
      this.stateManager.clearMessages();
      this.sendMessage({ type: 'historyCleared' });
    }
  }

  /**
   * Handle model selection
   */
  private async handleSelectModel(model?: string) {
    if (!this.client) {
      return;
    }

    try {
      // If model not provided, let user choose
      if (!model) {
        const models = await this.client.getModels();
        const modelNames = models.map((m) => m.name);

        if (modelNames.length === 0) {
          this.sendMessage({
            type: 'error',
            payload: { message: 'No models found. Please install a model in Ollama.' },
          });
          return;
        }

        const selected = await vscode.window.showQuickPick(modelNames, {
          placeHolder: 'Select a model',
        });
        model = selected;
      }

      if (model && this.stateManager) {
        this.stateManager.setCurrentModel(model);
        await OllamaConfigManager.setModel(model);

        this.sendMessage({
          type: 'modelSelected',
          payload: { model },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch models';
      ChatViewProvider.log('Model selection error:', errorMessage);
    }
  }

  /**
   * Update configuration from VS Code settings
   */
  private async updateConfiguration() {
    const config = OllamaConfigManager.getConfig();

    if (this.stateManager) {
      if (config.model) {
        this.stateManager.setCurrentModel(config.model);
      }
    }

    if (this.client) {
      this.client.setEndpoint(config.endpoint);
    }

    await this.checkConnection();
  }

  /**
   * Extract and validate file references from message
   * Looks for @filepath patterns and removes them from the message
   */
  private async extractFileReferences(message: string): Promise<{
    cleanMessage: string;
    fileReferences: FileReference[];
    fileContents: Array<{ path: string; language: string; content: string }>;
  }> {
    const fileReferences: FileReference[] = [];
    const fileContentsArray: Array<{ path: string; language: string; content: string }> = [];
    const displayMessage = message; // Keep the original message with @filename visible to user

    // Match @filepath patterns
    const fileRefRegex = /@([\w.\-/]+)/g;
    let match;

    while ((match = fileRefRegex.exec(message)) !== null) {
      const filePath = match[1];

      // Validate file path (must be within workspace and must exist)
      if (WorkspaceFileProvider.isValidFilePath(filePath)) {
        // Get file metadata
        const openFiles = WorkspaceFileProvider.getOpenFiles();
        const isOpen = openFiles.some(f => f.path === filePath);

        // Infer language from file extension
        const extension = filePath.split('.').pop() || 'plaintext';
        const languageMap: {[key: string]: string} = {
          'ts': 'typescript',
          'tsx': 'typescriptreact',
          'js': 'javascript',
          'jsx': 'javascriptreact',
          'py': 'python',
          'java': 'java',
          'go': 'go',
          'rs': 'rust',
          'md': 'markdown',
          'html': 'html',
          'css': 'css',
          'json': 'json',
        };
        const language = languageMap[extension] || 'plaintext';

        fileReferences.push({
          path: filePath,
          language,
          isOpen,
        });

        // Read file contents
        const fileResult = await FileReader.readFile(filePath);
        if (fileResult.success && fileResult.content) {
          fileContentsArray.push({
            path: filePath,
            language,
            content: fileResult.content,
          });
        } else {
          ChatViewProvider.log('Failed to read file:', filePath, fileResult.error);
        }
      } else {
        ChatViewProvider.log('Invalid file path reference:', filePath);
      }
    }

    return { cleanMessage: displayMessage, fileReferences, fileContents: fileContentsArray };
  }

  /**
   * Handle file search request from webview
   */
  private async handleSearchFiles(query: string) {
    try {
      ChatViewProvider.log('Searching files with query:', query);

      let results;
      if (query.trim() === '') {
        // Empty query - return open files
        results = WorkspaceFileProvider.getOpenFiles();
      } else {
        // Search for files matching the query
        results = await WorkspaceFileProvider.searchFiles(query);
      }

      // Limit results to first 50
      const limited = results.slice(0, 50);
      if (limited.length < results.length) {
        ChatViewProvider.log(`File search returned ${results.length} results, showing first ${limited.length}`);
      }

      this.sendMessage({
        type: 'fileSearchResults',
        payload: {
          query,
          results: limited,
          total: results.length
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error searching files';
      ChatViewProvider.log('File search error:', errorMessage);
      this.sendMessage({
        type: 'error',
        payload: { message: `Failed to search files: ${errorMessage}` },
      });
    }
  }

  /**
   * Send message to webview
   */
  private sendMessage(message: ExtensionMessage) {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  /**
   * Set input value in the chat webview
   * @param text The text to set in the input field
   * @param focusInput Whether to focus the input field
   */
  public setInputValue(text: string, focusInput: boolean = true) {
    this.sendMessage({
      type: 'setInputValue',
      payload: { text, focusInput },
    });
  }

  /**
   * Generate webview HTML content
   */
  private getWebviewContent(_webview: vscode.Webview): string {
    // Return embedded HTML with inline CSS and JS
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ollama Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            height: 100vh;
            width: 100vw;
            overflow: hidden;
        }

        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            background-color: var(--vscode-editor-background);
        }

        .chat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-panelTitle-activeBorder);
            flex-shrink: 0;
        }

        .chat-header h2 {
            font-size: 14px;
            font-weight: 600;
            margin: 0;
        }

        .header-btn {
            background: none;
            border: 1px solid transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .header-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .messages-area {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .welcome-message {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }

        .connection-status {
            display: flex;
            align-items: center;
            gap: 8px;
            justify-content: center;
            padding: 8px 16px;
            background-color: var(--vscode-panel-background);
            border-radius: 4px;
            font-size: 12px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }

        .status-dot.connected {
            background-color: #4ec9b0;
        }

        .status-dot.disconnected {
            background-color: #cd9731;
        }

        .status-dot.error {
            background-color: #f48771;
        }

        .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .model-selector {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
        }

        .model-selector select {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: none;
            padding: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
        }

        .model-selector select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .message-loading {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            background-color: var(--vscode-panel-background);
            border-radius: 6px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .message {
            display: flex;
            gap: 8px;
            animation: fadeIn 0.3s ease-in;
        }

        .message.user {
            justify-content: flex-end;
        }

        .message-content {
            max-width: 80%;
            padding: 10px 14px;
            border-radius: 6px;
            word-wrap: break-word;
            white-space: pre-wrap;
        }

        .message.user .message-content {
            background-color: var(--vscode-textBlockQuote-background);
            color: var(--vscode-foreground);
        }

        .message.assistant .message-content {
            background-color: var(--vscode-panel-background);
            color: var(--vscode-foreground);
        }

        /* File mention autocomplete dropdown */
        .file-mention-dropdown {
            position: absolute;
            bottom: 70px;
            left: 12px;
            right: 12px;
            max-height: 200px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            z-index: 1000;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            overflow-y: auto;
        }

        .file-mention-list {
            display: flex;
            flex-direction: column;
        }

        .file-mention-item {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 13px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .file-mention-item:hover,
        .file-mention-item.selected {
            background-color: var(--vscode-list-hoverBackground);
        }

        .file-mention-item.open::before {
            content: '🔓 ';
            font-size: 11px;
        }

        .file-mention-item.open {
            font-weight: 500;
        }

        .input-area {
            padding: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
            position: relative;
        }

        .context-badge {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 4px 8px;
            background-color: var(--vscode-panel-background);
            border-radius: 3px;
            width: fit-content;
        }

        .input-wrapper {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }

        .input-field {
            flex: 1;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            padding: 8px 12px;
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            resize: none;
            max-height: 80px;
        }

        .input-field:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .input-field:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .send-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            min-width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s;
        }

        .send-btn:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .error-message {
            font-size: 11px;
            color: #f48771;
            padding: 6px 8px;
            background-color: rgba(240, 127, 113, 0.1);
            border-radius: 3px;
        }

        #file-mention-list {
            display: flex;
            flex-direction: column;
        }

        .file-mention-item {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid #333;
            font-size: 13px;
            color: #e0e0e0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: background-color 0.15s;
        }

        .file-mention-item:hover {
            background-color: #333;
        }

        .file-mention-item.selected {
            background-color: #0e639c;
            color: #fff;
        }

        .file-mention-item.open::after {
            content: ' (open)';
            font-size: 11px;
            opacity: 0.7;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(8px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
</head>
<body>
    <div id="chat-container" class="chat-container">
        <div class="chat-header">
            <h2>Ollama Chat</h2>
            <button id="clear-btn" class="header-btn" title="Clear conversation">
                🗑️
            </button>
        </div>

        <div id="messages-area" class="messages-area">
            <div class="welcome-message">
                <h3>Welcome to Ollama Chat</h3>
                <p>Start a conversation with your local AI model</p>
                <div class="connection-status">
                    <span id="status-indicator" class="status-dot disconnected"></span>
                    <span id="status-text">Connecting...</span>
                </div>
            </div>
        </div>

        <div class="input-area">
            <div id="context-badge" class="context-badge" style="display: none;">
                📄 Selection included
            </div>
            <!-- File mention autocomplete -->
            <div id="file-mention-dropdown" class="file-mention-dropdown" style="display: none;">
                <div id="file-mention-list" class="file-mention-list"></div>
            </div>
            <div class="model-selector" id="model-selector" style="display: none;">
                <label for="model-select" style="font-weight: 500;">Model:</label>
                <select id="model-select" title="Select AI model">
                    <option>Loading...</option>
                </select>
            </div>
            <div class="input-wrapper">
                <div style="position: relative; flex-grow: 1;">
                    <textarea
                        id="input-field"
                        class="input-field"
                        placeholder="Type your message... Use @filename to reference files"
                        disabled
                    ></textarea>
                </div>
                <button id="send-btn" class="send-btn" title="Send message" disabled>
                    →
                </button>
            </div>
            <div id="error-message" class="error-message" style="display: none;"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        let conversationHistory = [];
        let isLoading = false;
        let connectionState = 'disconnected';
        let lastSelectedText = '';
        let fileMentionActive = false;
        let fileMentionSelectedIndex = -1;
        let currentFileSearchResults = [];

        const messagesArea = document.getElementById('messages-area');
        const inputField = document.getElementById('input-field');
        const sendBtn = document.getElementById('send-btn');
        const clearBtn = document.getElementById('clear-btn');
        const statusIndicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        const errorMessage = document.getElementById('error-message');
        const contextBadge = document.getElementById('context-badge');
        const modelSelector = document.getElementById('model-selector');
        const modelSelect = document.getElementById('model-select');
        const fileMentionDropdown = document.getElementById('file-mention-dropdown');
        const fileMentionList = document.getElementById('file-mention-list');

        function initialize() {
            setupEventListeners();
            vscode.postMessage({ type: 'webviewReady' });
        }

        function setupEventListeners() {
            sendBtn.addEventListener('click', sendMessage);
            clearBtn.addEventListener('click', clearHistory);
            modelSelect.addEventListener('change', (e) => {
                vscode.postMessage({
                    type: 'selectModel',
                    payload: { model: e.target.value }
                });
            });

            inputField.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                    if (fileMentionActive && fileMentionSelectedIndex >= 0) {
                        e.preventDefault();
                        selectFileMention(fileMentionSelectedIndex);
                        return;
                    }
                    if (!fileMentionActive) {
                        e.preventDefault();
                        sendMessage();
                    }
                } else if (e.key === 'Escape' && fileMentionActive) {
                    hideFileMentionDropdown();
                } else if (e.key === 'ArrowUp' && fileMentionActive) {
                    e.preventDefault();
                    fileMentionSelectedIndex = Math.max(0, fileMentionSelectedIndex - 1);
                    updateFileMentionHighlight();
                } else if (e.key === 'ArrowDown' && fileMentionActive) {
                    e.preventDefault();
                    fileMentionSelectedIndex = Math.min(currentFileSearchResults.length - 1, fileMentionSelectedIndex + 1);
                    updateFileMentionHighlight();
                }
            });

            inputField.addEventListener('input', (e) => {
                const text = inputField.value;
                const caretPos = inputField.selectionStart;
                const beforeCaret = text.substring(0, caretPos);
                const lastAtIndex = beforeCaret.lastIndexOf('@');

                if (lastAtIndex >= 0) {
                    const afterAt = text.substring(lastAtIndex + 1, caretPos);
                    if (/^[\\w./-]*$/.test(afterAt) && !afterAt.includes(' ')) {
                        showFileMentionDropdown(afterAt);
                        return;
                    }
                }
                hideFileMentionDropdown();
            });

            window.addEventListener('message', (event) => {
                const message = event.data;
                handleExtensionMessage(message);
            });
        }

        function handleExtensionMessage(message) {
            switch (message.type) {
                case 'addMessage':
                    renderMessage(message.payload.message);
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
                    showError(message.payload.message);
                    break;
                case 'modelSelected':
                    modelSelect.value = message.payload.model;
                    break;
                case 'historyCleared':
                    clearMessagesDisplay();
                    break;
                case 'fileSearchResults':
                    handleFileSearchResults(message.payload);
                    break;
                case 'setInputValue':
                    handleSetInputValue(message.payload);
                    break;
            }
        }

        function renderMessage(message) {
            if (conversationHistory.length === 0) {
                messagesArea.innerHTML = '';
            }

            conversationHistory.push(message);

            const div = document.createElement('div');
            div.className = 'message ' + message.role;
            div.id = 'message-' + message.id;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = message.content || '';

            div.appendChild(contentDiv);
            messagesArea.appendChild(div);
            scrollToBottom();
        }

        function handleResponseChunk(payload) {
            const { messageId, chunk } = payload;
            const el = document.getElementById('message-' + messageId);
            if (el) {
                const contentDiv = el.querySelector('.message-content');
                if (contentDiv) {
                    contentDiv.textContent += chunk;
                }
            }
        }

        function handleLoadingState(payload) {
            isLoading = payload.loading;
            inputField.disabled = isLoading;
            sendBtn.disabled = isLoading;

            if (isLoading) {
                sendBtn.textContent = '⟳';
            } else {
                sendBtn.textContent = '→';
            }
        }

        function handleConnectionState(payload) {
            connectionState = payload.state;
            statusIndicator.className = 'status-dot ' + payload.state;

            const map = {
                connected: '🟢 Connected',
                disconnected: '🟡 Disconnected',
                error: '🔴 Error'
            };
            statusText.textContent = map[payload.state] || payload.state;

            if (payload.models && payload.models.length > 0) {
                modelSelect.innerHTML = payload.models
                    .map(m => '<option value="' + m + '">' + m + '</option>')
                    .join('');
                // Set the current model if provided
                if (payload.currentModel) {
                    modelSelect.value = payload.currentModel;
                } else if (payload.models.length > 0) {
                    // Default to first model if no current model is set
                    modelSelect.value = payload.models[0];
                }
                modelSelector.style.display = 'flex';
            } else {
                modelSelector.style.display = 'none';
            }

            if (payload.state === 'connected' && !isLoading) {
                inputField.disabled = false;
                sendBtn.disabled = false;
            } else {
                inputField.disabled = true;
                sendBtn.disabled = true;
            }
        }

        function sendMessage() {
            const text = inputField.value.trim();
            if (!text || isLoading || connectionState !== 'connected') return;

            errorMessage.style.display = 'none';
            inputField.value = '';

            vscode.postMessage({
                type: 'userMessage',
                payload: { message: text }
            });
        }

        function clearHistory() {
            if (conversationHistory.length > 0 && confirm('Clear all messages?')) {
                vscode.postMessage({ type: 'clearHistory' });
            }
        }

        function clearMessagesDisplay() {
            conversationHistory = [];
            messagesArea.innerHTML = \`
                <div class="welcome-message">
                    <h3>Welcome to Ollama Chat</h3>
                    <p>Start a conversation with your local AI model</p>
                    <div class="connection-status">
                        <span class="status-dot \${connectionState}"></span>
                        <span>\${['connected', 'disconnected', 'error'].includes(connectionState) ? ['🟢 Connected', '🟡 Disconnected', '🔴 Error'][['connected', 'disconnected', 'error'].indexOf(connectionState)] : connectionState}</span>
                    </div>
                </div>
            \`;
        }

        function showError(msg) {
            errorMessage.textContent = '❌ ' + (msg || 'Error');
            errorMessage.style.display = 'block';
            setTimeout(() => { errorMessage.style.display = 'none'; }, 6000);
        }

        function scrollToBottom() {
            setTimeout(() => { messagesArea.scrollTop = messagesArea.scrollHeight; }, 0);
        }

        // File mention functions
        function showFileMentionDropdown(query) {
            fileMentionActive = true;
            fileMentionSelectedIndex = 0;
            vscode.postMessage({
                type: 'searchFiles',
                payload: { query }
            });
        }

        function hideFileMentionDropdown() {
            fileMentionActive = false;
            fileMentionSelectedIndex = -1;
            fileMentionDropdown.style.display = 'none';
            currentFileSearchResults = [];
        }

        function handleFileSearchResults(payload) {
            const { results } = payload;
            currentFileSearchResults = results;
            fileMentionSelectedIndex = 0;
            renderFileMentionDropdown();
        }

        function renderFileMentionDropdown() {
            if (!fileMentionActive || currentFileSearchResults.length === 0) {
                fileMentionDropdown.style.display = 'none';
                return;
            }

            fileMentionList.innerHTML = '';
            currentFileSearchResults.forEach((file, index) => {
                const div = document.createElement('div');
                div.className = 'file-mention-item';
                if (file.isOpen) div.classList.add('open');
                if (index === fileMentionSelectedIndex) div.classList.add('selected');

                div.textContent = file.path;
                div.addEventListener('click', () => selectFileMention(index));

                fileMentionList.appendChild(div);
            });

            fileMentionDropdown.style.display = 'block';
        }

        function updateFileMentionHighlight() {
            const items = fileMentionList.querySelectorAll('.file-mention-item');
            items.forEach((item, index) => {
                if (index === fileMentionSelectedIndex) {
                    item.classList.add('selected');
                    item.scrollIntoView({block: 'nearest'});
                } else {
                    item.classList.remove('selected');
                }
            });
        }

        function selectFileMention(index) {
            const file = currentFileSearchResults[index];
            if (!file) return;

            const text = inputField.value;
            const caretPos = inputField.selectionStart;
            const beforeCaret = text.substring(0, caretPos);
            const lastAtIndex = beforeCaret.lastIndexOf('@');

            if (lastAtIndex >= 0) {
                const before = text.substring(0, lastAtIndex);
                const after = text.substring(caretPos);
                const newText = before + '@' + file.path + ' ' + after;

                inputField.value = newText;
                inputField.selectionStart = inputField.selectionEnd = before.length + file.path.length + 2;
                inputField.focus();
            }

            hideFileMentionDropdown();
        }

        function handleSetInputValue(payload) {
            const { text, focusInput } = payload;
            inputField.value = text;
            if (focusInput) {
                inputField.focus();
                inputField.selectionStart = inputField.selectionEnd = text.length;
            }
        }

        initialize();
    </script>
</body>
</html>`;
  }
}
