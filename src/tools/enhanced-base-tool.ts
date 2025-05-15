import { ApiClient } from '../api-client.js';
import { ToolDefinition, McpToolResponse } from '../types.js';

/**
 * Enhanced base tool class that includes common functionality needed by all tools.
 * This will replace both BaseTool and BaseHandler in the consolidated architecture.
 */
export abstract class EnhancedBaseTool {
  protected apiClient?: ApiClient;
  protected server?: any;

  /**
   * Constructor that accepts optional dependencies.
   * Tools can be created with just the dependencies they need.
   */
  constructor(options?: { apiClient?: ApiClient, server?: any }) {
    this.apiClient = options?.apiClient;
    this.server = options?.server;
  }

  /**
   * Get the tool definition.
   * This is required for registering the tool with the MCP server.
   */
  abstract get definition(): ToolDefinition;

  /**
   * Execute the tool with the given arguments.
   * This is the main method that implements the tool's functionality.
   */
  abstract execute(args: unknown, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse>;

  /**
   * Helper method to format a successful response.
   */
  protected formatResponse(data: unknown): McpToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  /**
   * Helper method to format a JSON response.
   */
  protected formatJsonResponse(data: unknown): McpToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  /**
   * Helper method to format a text response.
   */
  protected formatTextResponse(text: string): McpToolResponse {
    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  }

  /**
   * Helper method to handle errors.
   */
  protected handleError(error: any): McpToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error}`,
        },
      ],
      isError: true,
    };
  }
}
