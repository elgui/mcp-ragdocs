import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse, RepositoryConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { error } from '../utils/logger.js';

const REPO_CONFIG_DIR = path.join(process.cwd(), 'repo-configs');

export class ListRepositoriesEnhancedTool extends EnhancedBaseTool {
  constructor(options?: any) {
    super(options);
  }

  get definition() {
    return {
      name: 'list_repositories',
      description: 'Lists all configured documentation repositories.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  }

  async execute(_args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    try {
      // Ensure the config directory exists
      try {
        await fs.mkdir(REPO_CONFIG_DIR, { recursive: true });
      } catch (err) {
        error(`Error creating repository config directory: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Get all repository config files
      let configFiles: string[];
      try {
        configFiles = await fs.readdir(REPO_CONFIG_DIR);
      } catch (error) {
        return this.formatTextResponse('No repositories found (config directory is empty)');
      }

      // Filter for JSON files
      configFiles = configFiles.filter(file => file.endsWith('.json'));

      if (configFiles.length === 0) {
        return this.formatTextResponse('No repositories found');
      }

      // Load each repository config
      const repositories: RepositoryConfig[] = [];
      for (const file of configFiles) {
        try {
          const configPath = path.join(REPO_CONFIG_DIR, file);
          const configContent = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent) as RepositoryConfig;
          repositories.push(config);
        } catch (err) {
          error(`Error loading repository config ${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Format the response
      const repoList = repositories.map(repo => {
        return `- ${repo.name} (${repo.path})
  Include: ${repo.include.join(', ')}
  Exclude: ${repo.exclude.join(', ')}
  Watch Mode: ${repo.watchMode ? 'Enabled' : 'Disabled'}
  File Types: ${Object.keys(repo.fileTypeConfig).length} configured`;
      });

      return this.formatTextResponse(
        repositories.length > 0
          ? `Found ${repositories.length} repositories:\n\n${repoList.join('\n\n')}`
          : 'No valid repositories found'
      );
    } catch (error) {
      return this.handleError(`Failed to list repositories: ${error}`);
    }
  }
}
