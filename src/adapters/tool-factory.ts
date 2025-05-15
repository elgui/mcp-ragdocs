import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { BaseTool } from '../tools/base-tool.js';
import { EnhancedBaseTool } from '../tools/enhanced-base-tool.js';
import { ToolHandlerAdapter } from './tool-handler-adapter.js';
import { BaseHandler } from '../handlers/base-handler.js';

/**
 * Factory class for creating tools and adapters.
 * This centralizes the creation logic and makes it easier to manage dependencies.
 */
export class ToolFactory {
  private server: Server;
  private apiClient: ApiClient;

  constructor(server: Server, apiClient: ApiClient) {
    this.server = server;
    this.apiClient = apiClient;
  }

  /**
   * Create a tool instance with the necessary dependencies.
   */
  createTool<T extends EnhancedBaseTool>(
    ToolClass: new (options?: { apiClient?: ApiClient, server?: any }) => T,
    options: { withApiClient?: boolean, withServer?: boolean } = {}
  ): T {
    const toolOptions: { apiClient?: ApiClient, server?: any } = {};
    
    if (options.withApiClient) {
      toolOptions.apiClient = this.apiClient;
    }
    
    if (options.withServer) {
      toolOptions.server = this.server;
    }
    
    return new ToolClass(toolOptions);
  }

  /**
   * Create a legacy tool instance.
   */
  createLegacyTool<T extends BaseTool>(
    ToolClass: new (apiClient?: ApiClient) => T,
    needsApiClient: boolean = true
  ): T {
    return new ToolClass(needsApiClient ? this.apiClient : undefined);
  }

  /**
   * Create a handler adapter that wraps a tool.
   * This allows tools to be used where handlers are expected.
   */
  createHandlerAdapter(tool: BaseTool | EnhancedBaseTool): BaseHandler {
    return new ToolHandlerAdapter(this.server, this.apiClient, tool as BaseTool);
  }
}
