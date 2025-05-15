import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { McpToolResponse } from '../types.js';

export abstract class BaseHandler {
  protected server: any; // Change type to any
  protected apiClient: ApiClient;

  constructor(server: any, apiClient: ApiClient) { // Change type to any
    this.server = server;
    this.apiClient = apiClient;
  }

  protected abstract handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse>;
}
