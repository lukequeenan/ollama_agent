/**
 * Command handlers for Ollama Chat extension
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ChatViewProvider } from './ui/ChatViewProvider';

/**
 * Get selected text from the active editor
 */
export function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    return undefined;
  }

  return editor.document.getText(selection);
}

/**
 * Clear chat history command handler
 */
export async function clearHistory() {
  vscode.window.showInformationMessage('Chat history cleared');
}

/**
 * Select model command handler
 */
export async function selectModel() {
  vscode.window.showInformationMessage('Opening model selector...');
}

/**
 * Open chat panel command handler
 */
export async function openPanel() {
  await vscode.commands.executeCommand('ollama-chat-panel.focus');
}

/**
 * Send selected code to chat handler
 */
export async function sendSelectionToChat(chatViewProvider: ChatViewProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No editor is open');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('No text selected');
    return;
  }

  // Get selected text
  const selectedText = editor.document.getText(selection);
  if (!selectedText.trim()) {
    vscode.window.showWarningMessage('No text selected');
    return;
  }

  // Get file path relative to workspace
  const filePath = editor.document.uri.fsPath;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('No workspace open');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const relativeFilePath = path.relative(workspaceRoot, filePath);

  // Focus the chat panel
  await vscode.commands.executeCommand('ollama-chat-panel.focus');

  // Insert the selected code with file reference into the chat input
  const inputText = `@${relativeFilePath}\n\n\`\`\`\n${selectedText}\n\`\`\``;
  chatViewProvider.setInputValue(inputText, true);
}
