/**
 * Ollama Chat Extension - Main entry point
 */

import * as vscode from 'vscode';
import * as commands from './commands';
import { ChatViewProvider } from './ui/ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Ollama Chat extension is now active!');

  // Register the chat view provider
  const chatViewProvider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ollama-chat.clearHistory', () => {
      commands.clearHistory();
    }),
    vscode.commands.registerCommand('ollama-chat.selectModel', () => {
      commands.selectModel();
    }),
    vscode.commands.registerCommand('ollama-chat.openPanel', () => {
      commands.openPanel();
    })
  );

  console.log('Ollama Chat extension activated successfully');
}

export function deactivate() {
  console.log('Ollama Chat extension deactivated');
}

