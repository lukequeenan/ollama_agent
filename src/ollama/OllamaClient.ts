/**
 * Ollama API client for communicating with local Ollama instance
 */

import axios, { AxiosInstance } from 'axios';
import { OllamaConfig, OllamaModel } from '../types/chat';

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
      OllamaClient.log('generateResponse error:', error);
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
      OllamaClient.log('Streaming request failed:', error);
      throw new Error(`Failed to stream response from Ollama: ${error}`);
    }
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
