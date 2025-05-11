import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from '../api-client.js';
import { ClearQueueTool } from '../tools/clear-queue.js';

export class ClearQueueHandler extends ClearQueueTool {
  constructor(server: Server, apiClient: ApiClient) {
    super();
  }

		async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }) {
				// ClearQueueTool.execute doesn't use callContext, so we don't pass it.
				return this.execute(args);
		}
}
