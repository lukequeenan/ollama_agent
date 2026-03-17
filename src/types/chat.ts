/**
 * Chat message types and configuration
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  context?: {
    selectedText?: string;
  };
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
}

export interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  currentModel: string;
  endpoint: string;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface OllamaModelsResponse {
  models: OllamaModel[];
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
}

/**
 * Message types for webview <-> extension communication
 */

export type WebviewMessage = UserMessageEvent | ClearHistoryEvent | SelectModelEvent;

export interface UserMessageEvent {
  type: 'userMessage';
  payload: {
    message: string;
    selectedText?: string;
  };
}

export interface ClearHistoryEvent {
  type: 'clearHistory';
}

export interface SelectModelEvent {
  type: 'selectModel';
}

export type ExtensionMessage =
  | AddMessageEvent
  | ResponseChunkEvent
  | LoadingStateEvent
  | ModelSelectedEvent
  | ErrorEvent;

export interface AddMessageEvent {
  type: 'addMessage';
  payload: ChatMessage;
}

export interface ResponseChunkEvent {
  type: 'responseChunk';
  payload: {
    messageId: string;
    chunk: string;
  };
}

export interface LoadingStateEvent {
  type: 'loadingState';
  payload: {
    loading: boolean;
  };
}

export interface ModelSelectedEvent {
  type: 'modelSelected';
  payload: {
    model: string;
  };
}

export interface ErrorEvent {
  type: 'error';
  payload: {
    message: string;
    code?: string;
  };
}
