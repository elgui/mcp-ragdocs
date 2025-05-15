import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse, RepositoryConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { RepositoryWatcher } from '../utils/repository-watcher.js';
import { RepositoryConfigLoader } from '../utils/repository-config-loader.js';
import { info, error } from '../utils/logger.js';
import { UpdateRepositoryEnhancedTool } from './update-repository-enhanced.js'; // Import the enhanced tool

const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

// Map to store active watchers - kept outside the class for now
const activeWatchers = new Map<string, RepositoryWatcher>();

export class WatchRepositoryEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'watch_repository',
      description: 'Starts or stops watching a repository for changes and updates the index.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the repository to watch.',
          },
          action: {
            type: 'string',
            description: 'The action to perform: "start" or "stop".',
            enum: ['start', 'stop'],
          },
        },
        required: ['name', 'action'],
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    if (!args.name || typeof args.name !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Repository name is required');
    }

    if (args.action !== 'start' && args.action !== 'stop') {
      throw new McpError(ErrorCode.InvalidParams, 'Action must be either "start" or "stop"');
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

      // Read the config
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent) as RepositoryConfig;

      // Get the UpdateRepositoryEnhancedTool instance via the toolFactory
      // Instantiate the UpdateRepositoryEnhancedTool directly, passing dependencies
      const updateTool = new UpdateRepositoryEnhancedTool({
        server: this.server,
        apiClient: this.apiClient,
      });


      if (args.action === 'start') {
        // Check if already watching
        if (activeWatchers.has(repoName)) {
          return this.formatTextResponse(`Repository ${repoName} is already being watched`);
        }

        // Create a new watcher
        const watcher = new RepositoryWatcher(
          config,
          async (changedFiles, removedFiles) => {
            info(`Repository ${repoName} changed: ${changedFiles.length} files changed, ${removedFiles.length} files removed`);

            // Update the repository index
            if (changedFiles.length > 0 || removedFiles.length > 0) {
              try {
                // Use the enhanced update tool
                await updateTool.execute({ name: repoName }, callContext);
                info(`Repository ${repoName} index updated successfully`);
              } catch (err) {
                error(`Failed to update repository ${repoName} index: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        );

        // Start watching
        await watcher.start();
        activeWatchers.set(repoName, watcher);

        // Update the config to reflect watch mode
        config.watchMode = true;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

        // Update the repositories.json configuration file
        if (!this.apiClient) {
           throw new Error('API client is required for RepositoryConfigLoader');
        }
        const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
        await configLoader.addRepositoryToConfig(config);

        return this.formatTextResponse(`Started watching repository: ${repoName} (${config.path})`);
      } else {
        // Stop watching
        const watcher = activeWatchers.get(repoName);
        if (!watcher) {
          return this.formatTextResponse(`Repository ${repoName} is not currently being watched`);
        }

        watcher.stop();
        activeWatchers.delete(repoName);

        // Update the config to reflect watch mode
        config.watchMode = false;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

        // Update the repositories.json configuration file
        if (!this.apiClient) {
           throw new Error('API client is required for RepositoryConfigLoader');
        }
        const configLoader = new RepositoryConfigLoader(this.server, this.apiClient);
        await configLoader.addRepositoryToConfig(config);

        return this.formatTextResponse(`Stopped watching repository: ${repoName} (${config.path})`);
      }
    } catch (err) {
      if (err instanceof McpError) {
        // Log the MCP error before re-throwing
        error(`MCP Error while trying to ${args.action} watching repository: ${err.message}`);
        throw err;
      }
      // Log the unexpected error using the logger
      error(`Unexpected error while trying to ${args.action} watching repository: ${err instanceof Error ? err.message : String(err)}`);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to ${args.action} watching repository. Check logs for details.`,
          },
        ],
        isError: true,
      };
    }
  }
}
