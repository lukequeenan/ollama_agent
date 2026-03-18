/**
 * File reading tool - allows AI to request file contents via tool calling
 */

import { FileReader, FileReadResult } from '../workspace/FileReader';

export interface ToolCall {
  name: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  toolName: string;
}

/**
 * FileReadTool - Implements the read_file tool that AI can call
 */
export class FileReadTool {
  static readonly toolName = 'read_file';

  /**
   * Execute a tool call
   * @param toolCall Object with tool name and parameters
   * @returns ToolResult with success status and output
   */
  static async execute(toolCall: ToolCall): Promise<ToolResult> {
    try {
      if (toolCall.name !== this.toolName) {
        return {
          success: false,
          toolName: toolCall.name,
          output: `Unknown tool: ${toolCall.name}`,
        };
      }

      if (!toolCall.path) {
        return {
          success: false,
          toolName: this.toolName,
          output: 'Error: path parameter is required',
        };
      }

      let result: FileReadResult;

      // Read specific lines if requested
      if (toolCall.startLine !== undefined && toolCall.endLine !== undefined) {
        result = await FileReader.readLines(toolCall.path, toolCall.startLine, toolCall.endLine);
      } else {
        result = await FileReader.readFile(toolCall.path);
      }

      if (!result.success) {
        return {
          success: false,
          toolName: this.toolName,
          output: `Error: ${result.error}`,
        };
      }

      // Format the output with file path and content
      let output = `File: ${result.path}\n---\n${result.content}`;

      if (result.truncated) {
        output += '\n\n[Note: File was truncated due to size limit]';
      }

      return {
        success: true,
        toolName: this.toolName,
        output,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        toolName: this.toolName,
        output: `Tool execution error: ${errorMessage}`,
      };
    }
  }
}
