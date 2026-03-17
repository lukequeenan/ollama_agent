/**
 * Command handlers for Ollama Chat extension
 */

import * as vscode from 'vscode';

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
