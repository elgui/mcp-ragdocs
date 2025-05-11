import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { BaseHandler } from './base-handler.js';
import { McpToolResponse } from '../types.js';

export class PromptsListHandler extends BaseHandler {
  constructor(server: Server, apiClient: ApiClient) {
    super(server, apiClient);
  }

  async handle(_args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    // Return an empty list of prompts
    // This is a minimal implementation to prevent the error
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ prompts: [] })
        }
      ]
    };
  }
}
