/**
 * Chat state management - maintains in-memory message history
 */

import { ChatMessage, ChatState, OllamaConfig } from '../types/chat';
import * as crypto from 'crypto';

export class ChatStateManager {
  private state: ChatState;

  constructor(config: OllamaConfig) {
    this.state = {
      messages: [],
      loading: false,
      currentModel: config.model,
      endpoint: config.endpoint,
    };
  }

  /**
   * Add a new message to the conversation
   */
  addMessage(
    role: 'user' | 'assistant',
    content: string,
    context?: { selectedText?: string }
  ): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: Date.now(),
      context,
    };

    this.state.messages.push(message);
    return message;
  }

  /**
   * Get all messages
   */
  getMessages(): ChatMessage[] {
    return [...this.state.messages];
  }

  /**
   * Get the conversation as a formatted prompt for Ollama
   */
  getConversationPrompt(): string {
    return this.state.messages
      .map((msg) => {
        const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
        return prefix + msg.content;
      })
      .join('\n\n');
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.state.messages = [];
  }

  /**
   * Update the current model
   */
  setCurrentModel(model: string): void {
    this.state.currentModel = model;
  }

  /**
   * Check if currently loading
   */
  isLoading(): boolean {
    return this.state.loading;
  }

  /**
   * Set loading state
   */
  setLoading(loading: boolean): void {
    this.state.loading = loading;
  }

  /**
   * Get current state
   */
  getState(): ChatState {
    return { ...this.state };
  }

  /**
   * Update a message content (for streaming responses)
   */
  updateMessage(messageId: string, content: string): void {
    const message = this.state.messages.find((m) => m.id === messageId);
    if (message) {
      message.content = content;
    }
  }

  /**
   * Get the last user message with optional context
   */
  getLastUserMessage(): ChatMessage | undefined {
    for (let i = this.state.messages.length - 1; i >= 0; i--) {
      if (this.state.messages[i].role === 'user') {
        return this.state.messages[i];
      }
    }
    return undefined;
  }
}
