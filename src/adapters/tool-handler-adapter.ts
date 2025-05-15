import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { McpToolResponse } from '../types.js';
import { BaseHandler } from '../handlers/base-handler.js';
import { BaseTool } from '../tools/base-tool.js';
import { EnhancedBaseTool } from '../tools/enhanced-base-tool.js';

/**
 * Adapter class that wraps a BaseTool or EnhancedBaseTool and exposes it as a BaseHandler.
 * This provides backward compatibility during the migration from handlers to tools.
 */
export class ToolHandlerAdapter extends BaseHandler {
  private tool: BaseTool | EnhancedBaseTool;

  constructor(server: any, apiClient: ApiClient, tool: BaseTool | EnhancedBaseTool) {
    super(server, apiClient);
    this.tool = tool;
  }

  /**
   * Implements the handle method required by BaseHandler.
   * Delegates to the wrapped tool's execute method.
   */
  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    return await this.tool.execute(args, callContext);
  }

  /**
   * Get the tool definition from the wrapped tool.
   */
  get definition() {
    return this.tool.definition;
  }
}
