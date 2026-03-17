/**
 * Ollama configuration management - retrieves settings from VS Code
 */

import * as vscode from 'vscode';
import { OllamaConfig } from '../types/chat';
import * as fs from 'fs';

export class OllamaConfigManager {
  /**
   * Get the WSL2 gateway IP from resolv.conf
   */
  private static getWSL2Gateway(): string {
    try {
      const resolvConf = fs.readFileSync('/etc/resolv.conf', 'utf-8');
      const lines = resolvConf.split('\n');
      for (const line of lines) {
        if (line.startsWith('nameserver')) {
          const ip = line.split(' ')[1]?.trim();
          if (ip && ip !== '127.0.0.1') {
            return ip;
          }
        }
      }
    } catch (error) {
      // File doesn't exist or can't be read - not in WSL2
    }
    return 'localhost';
  }

  /**
   * Detect the Ollama endpoint - tries WSL2 gateway, then falls back to defaults
   */
  private static detectEndpoint(): string {
    // Check if running in WSL2
    try {
      if (fs.existsSync('/etc/resolv.conf')) {
        const gateway = this.getWSL2Gateway();
        if (gateway !== 'localhost') {
          const endpoint = `http://${gateway}:11434`;
          console.log(`[OllamaConfig] Detected WSL2 environment, using gateway: ${endpoint}`);
          return endpoint;
        }
      }
    } catch (error) {
      // Silently fail - will fall back to default
    }

    // Default to host.docker.internal (works on Docker Desktop)
    console.log('[OllamaConfig] Using default endpoint: http://host.docker.internal:11434');
    return 'http://host.docker.internal:11434';
  }

  /**
   * Get current Ollama configuration from VS Code settings
   */
  static getConfig(): OllamaConfig {
    const config = vscode.workspace.getConfiguration('ollama');
    const configured = config.get('endpoint');

    // Use configured endpoint if set, otherwise detect
    let endpoint = configured || this.detectEndpoint();

    return {
      endpoint,
      model: config.get('model') || 'qwen3.5:4b',
    };
  }

  /**
   * Update the selected model in settings
   */
  static async setModel(model: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('ollama');
    await config.update('model', model, vscode.ConfigurationTarget.Global);
  }

  /**
   * Update the Ollama endpoint in settings
   */
  static async setEndpoint(endpoint: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('ollama');
    await config.update('endpoint', endpoint, vscode.ConfigurationTarget.Global);
  }

  /**
   * Get all configured values for debugging
   */
  static getAllSettings() {
    const config = vscode.workspace.getConfiguration('ollama');
    return {
      endpoint: config.get('endpoint'),
      model: config.get('model'),
    };
  }
}
