/**
 * Chat message types and configuration
 */

export interface FileReference {
  path: string;
  language: string;
  isOpen: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  context?: {
    selectedText?: string;
  };
  fileReferences?: FileReference[];
  fileContents?: Array<{
    path: string;
    language: string;
    content: string;
  }>;
}

export interface OllamaConfig {
  endpoint: string;
  model?: string;
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

export type WebviewMessage =
  | UserMessageEvent
  | ClearHistoryEvent
  | SelectModelEvent
  | SearchFilesEvent
  | WebviewReadyEvent;

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
  payload?: {
    model?: string;
  };
}

export interface SearchFilesEvent {
  type: 'searchFiles' | 'fileSearch';
  payload: {
    query: string;
  };
}

export interface WebviewReadyEvent {
  type: 'webviewReady';
}

export type ExtensionMessage =
  | AddMessageEvent
  | ResponseChunkEvent
  | LoadingStateEvent
  | ModelSelectedEvent
  | ErrorEvent
  | ConnectionStateEvent
  | HistoryClearedEvent
  | FileSearchResultsEvent
  | SetInputValueEvent;

export interface AddMessageEvent {
  type: 'addMessage';
  payload: {
    message: ChatMessage;
  };
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

export interface ConnectionStateEvent {
  type: 'connectionState';
  payload: {
    state: 'connected' | 'disconnected' | 'error';
    models?: string[];
  };
}

export interface HistoryClearedEvent {
  type: 'historyCleared';
}

export interface FileSearchResultsEvent {
  type: 'fileSearchResults';
  payload: {
    query: string;
    results: FileReference[];
    total: number;
  };
}

export interface SetInputValueEvent {
  type: 'setInputValue';
  payload: {
    text: string;
    focusInput: boolean;
  };
}
