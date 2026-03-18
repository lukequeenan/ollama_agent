/**
 * Ollama API client for communicating with local Ollama instance
 */

import axios, { AxiosInstance } from 'axios';
import { OllamaConfig, OllamaModel, FileReference } from '../types/chat';
import { FileReadTool, ToolCall, ToolResult } from '../tools/FileReadTool';

export class OllamaClient {
  private client: AxiosInstance;
  private endpoint: string;
  private static readonly DEBUG = false; // Set to true for development logging

  constructor(config: OllamaConfig) {
    this.endpoint = config.endpoint;
    this.client = axios.create({
      baseURL: config.endpoint,
      timeout: 30000,
    });
  }

  /**
   * Debug logging (only when DEBUG is true)
   */
  private static log(...args: unknown[]) {
    if (OllamaClient.DEBUG) {
      console.log('[OllamaClient]', ...args);
    }
  }

  /**
   * Check if Ollama server is reachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      OllamaClient.log('Attempting connection to:', this.endpoint);
      const response = await this.client.get('/api/tags');
      console.log('[OllamaClient] ✓ Success, found models:', response.data.models?.length || 0);
      return true;
    } catch (error) {
      console.error('[OllamaClient] Failed to reach endpoint:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Get list of available models
   */
  async getModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.client.get('/api/tags');
      return response.data.models || [];
    } catch (error) {
      throw new Error(`Failed to fetch models from Ollama: ${error}`);
    }
  }

  /**
   * Generate a response from Ollama (non-streaming)
   */
  async generateResponse(
    prompt: string,
    model: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    try {
      console.log('[OllamaClient] generateResponse called, model:', model, 'prompt length:', prompt.length);
      console.log('[OllamaClient] Using endpoint:', this.endpoint);
      const config = {
        model,
        prompt,
        stream: !!onChunk, // Use streaming if callback provided
      };

      if (onChunk) {
        // Streaming response
        console.log('[OllamaClient] Using streaming response');
        return await this.generateStreamingResponse(config, onChunk);
      } else {
        // Non-streaming response
        console.log('[OllamaClient] Using non-streaming response');
        const response = await this.client.post('/api/generate', config);
        if (response.data && response.data.response) {
          console.log('[OllamaClient] Got response:', response.data.response.substring(0, 100));
          return response.data.response;
        }
        throw new Error('Empty response from Ollama');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[OllamaClient] Error details:', errorMsg);
      if (error && typeof error === 'object' && 'response' in error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axiosError = error as any;
        console.error('[OllamaClient] Response status:', axiosError.response?.status);
        console.error('[OllamaClient] Response error:', axiosError.response?.data);
      }
      throw new Error(`Failed to generate response from Ollama: ${error}`);
    }
  }

  /**
   * Generate a streaming response from Ollama
   */
  private async generateStreamingResponse(
    request: { model: string; prompt: string; stream: boolean },
    onChunk: (chunk: string) => void
  ): Promise<string> {
    try {
      console.log('[OllamaClient] Streaming to:', `${this.endpoint}/api/generate`);
      console.log('[OllamaClient] Request model:', request.model);
      const response = await this.client.post('/api/generate', request, {
        responseType: 'stream',
      });

      return new Promise((resolve, reject) => {
        let fullResponse = '';
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');

          // Process all complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line) {
              try {
                const data = JSON.parse(line);
                if (data.response) {
                  fullResponse += data.response;
                  onChunk(data.response);
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          // Keep the last incomplete line in the buffer
          buffer = lines[lines.length - 1];
        });

        response.data.on('end', () => {
          // Process any remaining data in the buffer
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              if (data.response) {
                fullResponse += data.response;
                onChunk(data.response);
              }
            } catch {
              // Skip malformed JSON
            }
          }
          resolve(fullResponse);
        });

        response.data.on('error', (_error: Error) => {
          OllamaClient.log('Stream error:', _error.message);
          reject(new Error(`Stream error: ${_error.message}`));
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[OllamaClient] Streaming request failed:', errorMsg);
      if (error && typeof error === 'object' && 'response' in error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axiosError = error as any;
        console.error('[OllamaClient] Response status:', axiosError.response?.status);
        console.error('[OllamaClient] Response data:', axiosError.response?.data);
        console.error('[OllamaClient] Endpoint:', `${this.endpoint}/api/generate`);
      }
      throw new Error(`Failed to stream response from Ollama: ${error}`);
    }
  }

  /**
   * Generate a response with tool calling support
   * Implements a loop that detects tool calls, executes them, and regenerates
   */
  async generateResponseWithTools(
    prompt: string,
    model: string,
    onChunk?: (chunk: string) => void,
    fileReferences?: FileReference[]
  ): Promise<string> {
    const maxIterations = 5;
    let iteration = 0;
    let fullResponse = '';
    let conversationContext = '';

    // Build system prompt with tool definitions
    const systemPrompt = this.buildSystemPromptWithTools(fileReferences);

    while (iteration < maxIterations) {
      try {
        // Generate response (with or without streaming)
        const fullPrompt = systemPrompt + conversationContext + prompt;

        let responseChunk = '';
        const chunkCallback = onChunk
          ? (chunk: string) => {
              responseChunk += chunk;
              onChunk(chunk);
            }
          : undefined;

        const response = await this.generateResponse(fullPrompt, model, chunkCallback);
        fullResponse += response;

        // Parse for tool calls
        const toolCalls = this.parseToolCalls(response);

        if (toolCalls.length === 0) {
          // No tool calls, we're done
          return fullResponse;
        }

        // Execute tools and collect results
        const toolResults: Array<{ call: ToolCall; result: ToolResult }> = [];
        for (const toolCall of toolCalls) {
          const result = await FileReadTool.execute(toolCall);
          toolResults.push({ call: toolCall, result });
        }

        // Append tool results to conversation context for next iteration
        conversationContext += response;
        for (const { call, result } of toolResults) {
          conversationContext += `\n\n[Tool: ${call.name}(path="${call.path}")]\n${result.output}`;
        }

        iteration++;
      } catch (error) {
        console.error('[OllamaClient] Error in tool calling loop:', error);
        // Return partial response on error
        return fullResponse;
      }
    }

    // Max iterations reached
    console.warn('[OllamaClient] Tool calling reached max iterations (' + maxIterations + ')');
    return fullResponse;
  }

  /**
   * Build system prompt with tool definitions and file references
   */
  private buildSystemPromptWithTools(fileReferences?: FileReference[]): string {
    let systemPrompt = `You have access to the following tools to help answer questions:

**read_file(path="<file_path>"[, startLine=N, endLine=M])**
  - Read the contents of a file in the workspace
  - path: Relative path to the file (e.g., "src/utils/helpers.ts")
  - startLine, endLine: Optional line numbers (1-based, inclusive)
  - When you need to examine file contents, use this tool
  - After you call a tool, the file contents will be provided

`;

    if (fileReferences && fileReferences.length > 0) {
      systemPrompt += `The user has referenced these files:\n`;
      for (const ref of fileReferences) {
        systemPrompt += `  - ${ref.path} (${ref.language})\n`;
      }
      systemPrompt += `\nYou can read these files using the read_file tool.\n\n`;
    }

    return systemPrompt;
  }

  /**
   * Parse tool calls from AI response
   * Looks for pattern: read_file(path="...")
   * Optionally: read_file(path="...", startLine=N, endLine=M)
   */
  private parseToolCalls(response: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // Match read_file(path="...") with optional startLine and endLine
    // Handles paths with spaces and escaped quotes
    const regex = /read_file\(\s*path\s*=\s*["']([^"']+)["'](?:\s*,\s*startLine\s*=\s*(\d+)\s*,\s*endLine\s*=\s*(\d+))?\s*\)/g;
    let match;

    while ((match = regex.exec(response)) !== null) {
      const path = match[1];
      const startLine = match[2] ? parseInt(match[2], 10) : undefined;
      const endLine = match[3] ? parseInt(match[3], 10) : undefined;

      toolCalls.push({
        name: 'read_file',
        path,
        startLine,
        endLine,
      });
    }

    return toolCalls;
  }

  /**
   * Change the Ollama endpoint
   */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
    this.client = axios.create({
      baseURL: endpoint,
      timeout: 30000,
    });
  }
}
