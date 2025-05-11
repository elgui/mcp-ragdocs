import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { BaseHandler } from './base-handler.js';
import { McpToolResponse } from '../types.js';

export class ResourcesListHandler extends BaseHandler {
  constructor(server: Server, apiClient: ApiClient) {
    super(server, apiClient);
  }

  async handle(_args: any): Promise<McpToolResponse> {
    // Return an empty list of resources
    // This is a minimal implementation to prevent the error
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ resources: [] })
        }
      ]
    };
  }
}
