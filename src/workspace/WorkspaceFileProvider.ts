/**
 * Workspace file provider - discovers files in the workspace
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileMetadata {
  path: string; // Relative path from workspace root
  language: string;
  isOpen: boolean;
}

export class WorkspaceFileProvider {
  private static readonly EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'build',
    '.DS_Store',
    '.env',
    '.env.local',
    '.next',
    'out',
  ];

  /**
   * Get the workspace folder path
   */
  static getWorkspaceFolderPath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    // Return the first workspace folder
    return folders[0].uri.fsPath;
  }

  /**
   * Get list of currently open files
   */
  static getOpenFiles(): FileMetadata[] {
    const workspacePath = this.getWorkspaceFolderPath();
    if (!workspacePath) {
      return [];
    }

    const openFiles: FileMetadata[] = [];

    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = editor.document.uri.fsPath;

      // Only include files within the workspace
      if (filePath.startsWith(workspacePath)) {
        const relativePath = path.relative(workspacePath, filePath);
        openFiles.push({
          path: relativePath,
          language: editor.document.languageId,
          isOpen: true,
        });
      }
    }

    // Sort by path for consistency
    openFiles.sort((a, b) => a.path.localeCompare(b.path));
    return openFiles;
  }

  /**
   * Search for files matching a pattern in the workspace
   * Returns both open and closed files
   */
  static async searchFiles(pattern: string): Promise<FileMetadata[]> {
    const workspacePath = this.getWorkspaceFolderPath();
    if (!workspacePath) {
      return [];
    }

    try {
      // Use VS Code's built-in file search (faster)
      const files = await vscode.workspace.findFiles(`**/${pattern}*`, null, 50);

      const results: FileMetadata[] = [];
      const openFileSet = new Set(this.getOpenFiles().map(f => f.path));

      for (const file of files) {
        const relativePath = path.relative(workspacePath, file.fsPath);

        // Skip excluded patterns
        if (this.shouldExcludePath(relativePath)) {
          continue;
        }

        results.push({
          path: relativePath,
          language: this.getLanguageFromPath(relativePath),
          isOpen: openFileSet.has(relativePath),
        });
      }

      // Sort: open files first, then by path
      results.sort((a, b) => {
        if (a.isOpen !== b.isOpen) {
          return b.isOpen ? 1 : -1; // Open files first
        }
        return a.path.localeCompare(b.path);
      });

      return results;
    } catch (error) {
      console.error('[WorkspaceFileProvider] Error searching files:', error);
      return [];
    }
  }

  /**
   * Get all files in the workspace (recursive)
   * Used for full workspace crawl if needed
   */
  static async getAllFiles(): Promise<FileMetadata[]> {
    const workspacePath = this.getWorkspaceFolderPath();
    if (!workspacePath) {
      return [];
    }

    try {
      const files = await vscode.workspace.findFiles('**/*', null, 200);
      const results: FileMetadata[] = [];
      const openFileSet = new Set(this.getOpenFiles().map(f => f.path));

      for (const file of files) {
        const relativePath = path.relative(workspacePath, file.fsPath);

        // Skip excluded patterns and directories
        if (this.shouldExcludePath(relativePath)) {
          continue;
        }

        // Skip directories
        if (fs.statSync(file.fsPath).isDirectory()) {
          continue;
        }

        results.push({
          path: relativePath,
          language: this.getLanguageFromPath(relativePath),
          isOpen: openFileSet.has(relativePath),
        });
      }

      // Sort: open files first, then by path
      results.sort((a, b) => {
        if (a.isOpen !== b.isOpen) {
          return b.isOpen ? 1 : -1;
        }
        return a.path.localeCompare(b.path);
      });

      return results;
    } catch (error) {
      console.error('[WorkspaceFileProvider] Error getting all files:', error);
      return [];
    }
  }

  /**
   * Check if a file path should be excluded based on patterns
   */
  private static shouldExcludePath(relativePath: string): boolean {
    for (const pattern of this.EXCLUDE_PATTERNS) {
      if (relativePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine language ID from file extension
   */
  private static getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const extensionMap: {[key: string]: string} = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
    };

    return extensionMap[ext] || 'plaintext';
  }

  /**
   * Validate that a file path is safe and within workspace
   */
  static isValidFilePath(filePath: string): boolean {
    const workspacePath = this.getWorkspaceFolderPath();
    if (!workspacePath) {
      return false;
    }

    // Normalize the path to prevent directory traversal attacks
    const absolutePath = path.resolve(workspacePath, filePath);
    const normalizedWorkspacePath = path.resolve(workspacePath);

    // Check if the resolved path is within the workspace
    return absolutePath.startsWith(normalizedWorkspacePath);
  }
}
