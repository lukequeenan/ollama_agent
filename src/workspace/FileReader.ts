/**
 * File reader - safely reads file contents from the workspace
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceFileProvider } from './WorkspaceFileProvider';

export interface FileReadResult {
  success: boolean;
  content?: string;
  error?: string;
  path: string;
  truncated?: boolean;
}

export class FileReader {
  private static readonly MAX_FILE_SIZE = 1024 * 1024; // 1MB
  private static readonly TRUNCATION_INDICATOR = '\n... (file truncated, too large to display) ...';

  /**
   * Read a file from the workspace
   * @param filePath Relative path from workspace root
   * @returns Result with content or error
   */
  static async readFile(filePath: string): Promise<FileReadResult> {
    try {
      // Validate the file path
      if (!WorkspaceFileProvider.isValidFilePath(filePath)) {
        return {
          success: false,
          path: filePath,
          error: 'Invalid file path or outside workspace',
        };
      }

      const workspacePath = WorkspaceFileProvider.getWorkspaceFolderPath();
      if (!workspacePath) {
        return {
          success: false,
          path: filePath,
          error: 'No workspace folder open',
        };
      }

      const absolutePath = path.resolve(workspacePath, filePath);

      // Check if file exists
      if (!fs.existsSync(absolutePath)) {
        return {
          success: false,
          path: filePath,
          error: `File not found: ${filePath}`,
        };
      }

      // Check if it's a file (not a directory)
      const stats = fs.statSync(absolutePath);
      if (!stats.isFile()) {
        return {
          success: false,
          path: filePath,
          error: `Path is not a file: ${filePath}`,
        };
      }

      // Check file size
      let truncated = false;
      if (stats.size > this.MAX_FILE_SIZE) {
        truncated = true;
      }

      // Read the file
      const content = fs.readFileSync(absolutePath, 'utf-8');

      // Truncate if necessary
      let finalContent = content;
      if (truncated && content.length > this.MAX_FILE_SIZE) {
        finalContent = content.substring(0, this.MAX_FILE_SIZE) + this.TRUNCATION_INDICATOR;
      }

      return {
        success: true,
        content: finalContent,
        path: filePath,
        truncated,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        path: filePath,
        error: `Error reading file: ${errorMessage}`,
      };
    }
  }

  /**
   * Read multiple files in a batch
   * @param filePaths Array of relative paths
   * @returns Array of results
   */
  static async readMultiple(filePaths: string[]): Promise<FileReadResult[]> {
    return Promise.all(filePaths.map(filePath => this.readFile(filePath)));
  }

  /**
   * Check if a file is readable and return minimal metadata
   * @param filePath Relative path from workspace root
   */
  static fileExists(filePath: string): boolean {
    try {
      if (!WorkspaceFileProvider.isValidFilePath(filePath)) {
        return false;
      }

      const workspacePath = WorkspaceFileProvider.getWorkspaceFolderPath();
      if (!workspacePath) {
        return false;
      }

      const absolutePath = path.resolve(workspacePath, filePath);
      return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Read specific lines from a file
   * @param filePath Relative path from workspace root
   * @param startLine 1-based line number
   * @param endLine 1-based line number (inclusive)
   */
  static async readLines(filePath: string, startLine: number, endLine: number): Promise<FileReadResult> {
    try {
      const result = await this.readFile(filePath);
      if (!result.success) {
        return result;
      }

      const lines = result.content!.split('\n');
      const start = Math.max(0, startLine - 1);
      const end = Math.min(lines.length, endLine);
      const selectedLines = lines.slice(start, end).join('\n');

      return {
        success: true,
        content: selectedLines,
        path: filePath,
        truncated: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        path: filePath,
        error: `Error reading lines: ${errorMessage}`,
      };
    }
  }
}
