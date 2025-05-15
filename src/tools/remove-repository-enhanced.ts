import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse, ToolDefinition } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';

const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');
const COLLECTION_NAME = 'documentation';

export class RemoveRepositoryEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition(): ToolDefinition {
    return {
      name: 'remove_repository',
      description: 'Removes a configured documentation repository and its indexed documents.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the repository to remove.',
          },
        },
        required: ['name'],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!args.name || typeof args.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository name is required');
    }

    const repoName = args.name;
    const configPath = path.join(REPO_CONFIG_DIR, `${repoName}.json`);

    try {
      // Check if the repository config exists
      let config;
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(configContent);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, `Repository not found: ${repoName}`);
      }

      // Remove the repository config file
      await fs.unlink(configPath);

      // Update the repositories.json configuration file
      // RepositoryConfigLoader needs both server and apiClient
      if (!this.server || !this.apiClient) {
         throw new Error('Server and API client are required for RepositoryConfigLoader');
      }
      const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
      await configLoader.removeRepositoryFromConfig(repoName);

      // Remove repository documents from the vector database
      if (!this.apiClient) {
        throw new Error('API client is required for Qdrant operations');
      }
      await this.apiClient.qdrantClient.delete(COLLECTION_NAME, {
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

      return this.formatResponse({
        content: [
          {
            type: 'text',
            text: `Successfully removed repository: ${repoName} (${config.path})`,
          },
        ],
      });

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.formatResponse({
        content: [
          {
            type: 'text',
            text: `Failed to remove repository: ${error}`,
          },
        ],
        isError: true,
      });
    }
  }
}
