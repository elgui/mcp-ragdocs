import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import { McpToolResponse } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';

const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');
const COLLECTION_NAME = 'documentation';

export class RemoveRepositoryHandler extends BaseHandler {
  async handle(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!args.name || typeof args.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository name is required');
    }

    const repoName = args.name;
    const configPath = path.join(REPO_CONFIG_DIR, `${repoName}.json`);

    try {
      // Check if the repository config exists
      try {
        await fs.access(configPath);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, `Repository not found: ${repoName}`);
      }

      // Read the config to get repository details
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Remove the repository config file
      await fs.unlink(configPath);

      // Update the repositories.json configuration file
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.removeRepositoryFromConfig(repoName);

      // Remove repository documents from the vector database
      const result = await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
        filter: {
          must: [
            {
              key: 'repository',
              match: { value: repoName }
            },
            {
              key: 'isRepositoryFile',
              match: { value: true }
            }
          ]
        },
        wait: true
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully removed repository: ${repoName} (${config.path})`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return {
        content: [
          {
            type: 'text',
            text: `Failed to remove repository: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
}
