import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from './api-client.js';
import { ToolDefinition } from './types.js';
import {
  AddDocumentationHandler,
  SearchDocumentationHandler,
  ListSourcesHandler,
  RemoveDocumentationHandler,
  ExtractUrlsHandler,
  ListQueueHandler,
  RunQueueHandler,
  ClearQueueHandler,
  PromptsListHandler,
  ResourcesListHandler,
  LocalRepositoryHandler,
  ListRepositoriesHandler,
  RemoveRepositoryHandler,
  UpdateRepositoryHandler,
  WatchRepositoryHandler,
  GetIndexingStatusHandler,
} from './handlers/index.js';

const COLLECTION_NAME = 'documentation';

export class HandlerRegistry {
  private server: Server;
  private apiClient: ApiClient;
  private handlers: Map<string, any>;

  constructor(server: Server, apiClient: ApiClient) {
    this.server = server;
    this.apiClient = apiClient;
    this.handlers = new Map();
    this.setupHandlers();
    this.registerHandlers();
  }

  private setupHandlers() {
    // Web documentation handlers
    this.handlers.set('add_documentation', new AddDocumentationHandler(this.server, this.apiClient));
    this.handlers.set('search_documentation', new SearchDocumentationHandler(this.server, this.apiClient));
    this.handlers.set('list_sources', new ListSourcesHandler(this.server, this.apiClient));
    this.handlers.set('remove_documentation', new RemoveDocumentationHandler(this.server, this.apiClient));
    this.handlers.set('extract_urls', new ExtractUrlsHandler(this.server, this.apiClient));
    this.handlers.set('list_queue', new ListQueueHandler(this.server, this.apiClient));
    this.handlers.set('run_queue', new RunQueueHandler(this.server, this.apiClient));
    this.handlers.set('clear_queue', new ClearQueueHandler(this.server, this.apiClient));

    // Repository handlers
    this.handlers.set('add_repository', new LocalRepositoryHandler(this.server, this.apiClient));
    this.handlers.set('list_repositories', new ListRepositoriesHandler(this.server, this.apiClient));
    this.handlers.set('remove_repository', new RemoveRepositoryHandler(this.server, this.apiClient));
    this.handlers.set('update_repository', new UpdateRepositoryHandler(this.server, this.apiClient));
    this.handlers.set('watch_repository', new WatchRepositoryHandler(this.server, this.apiClient));
    this.handlers.set('get_indexing_status', new GetIndexingStatusHandler(this.server, this.apiClient));

    // Setup prompts and resources handlers
    this.handlers.set('prompts/list', new PromptsListHandler(this.server, this.apiClient));
    this.handlers.set('resources/list', new ResourcesListHandler(this.server, this.apiClient));
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_documentation',
          description: 'Search through stored documentation using natural language queries. Use this tool to find relevant information across all stored documentation sources. Returns matching excerpts with context, ranked by relevance. Useful for finding specific information, code examples, or related documentation.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The text to search for in the documentation. Can be a natural language query, specific terms, or code snippets.',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (1-20). Higher limits provide more comprehensive results but may take longer to process. Default is 5.',
                default: 5,
              },
            },
            required: ['query'],
          },
        } as ToolDefinition,
        {
          name: 'add_documentation',
          description: 'Add new documentation to the system by providing a URL. The tool will fetch the content, process it into chunks, and store it in the vector database for future searches. Supports various web page formats and automatically extracts relevant content.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The complete URL of the documentation to add (must include protocol, e.g., https://). The page must be publicly accessible.',
              },
            },
            required: ['url'],
          },
        } as ToolDefinition,
        {
          name: 'list_sources',
          description: 'List all documentation sources currently stored in the system. Returns a comprehensive list of all indexed documentation including source URLs, titles, and last update times. Use this to understand what documentation is available for searching or to verify if specific sources have been indexed.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        } as ToolDefinition,
        {
          name: 'extract_urls',
          description: 'Extract and analyze all URLs from a given web page. This tool crawls the specified webpage, identifies all hyperlinks, and optionally adds them to the processing queue. Useful for discovering related documentation pages, API references, or building a documentation graph. Handles various URL formats and validates links before extraction.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The complete URL of the webpage to analyze (must include protocol, e.g., https://). The page must be publicly accessible.',
              },
              add_to_queue: {
                type: 'boolean',
                description: 'If true, automatically add extracted URLs to the processing queue for later indexing. This enables recursive documentation discovery. Use with caution on large sites to avoid excessive queuing.',
                default: false,
              },
            },
            required: ['url'],
          },
        } as ToolDefinition,
        {
          name: 'remove_documentation',
          description: 'Remove specific documentation sources from the system by their URLs. Use this tool to clean up outdated documentation, remove incorrect sources, or manage the documentation collection. The removal is permanent and will affect future search results. Supports removing multiple URLs in a single operation.',
          inputSchema: {
            type: 'object',
            properties: {
              urls: {
                type: 'array',
                items: {
                  type: 'string',
                  description: 'The complete URL of the documentation source to remove. Must exactly match the URL used when the documentation was added.',
                },
                description: 'Array of URLs to remove from the database',
              },
            },
            required: ['urls'],
          },
        } as ToolDefinition,
        {
          name: 'list_queue',
          description: 'List all URLs currently waiting in the documentation processing queue. Shows pending documentation sources that will be processed when run_queue is called. Use this to monitor queue status, verify URLs were added correctly, or check processing backlog. Returns URLs in the order they will be processed.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        } as ToolDefinition,
        {
          name: 'run_queue',
          description: 'Process and index all URLs currently in the documentation queue. Each URL is processed sequentially, with proper error handling and retry logic. Progress updates are provided as processing occurs. Use this after adding new URLs to ensure all documentation is indexed and searchable. Long-running operations will process until the queue is empty or an unrecoverable error occurs.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        } as ToolDefinition,
        {
          name: 'clear_queue',
          description: 'Remove all pending URLs from the documentation processing queue. Use this to reset the queue when you want to start fresh, remove unwanted URLs, or cancel pending processing. This operation is immediate and permanent - URLs will need to be re-added if you want to process them later. Returns the number of URLs that were cleared from the queue.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        } as ToolDefinition,
        {
          name: 'add_repository',
          description: 'Add a local code repository to the documentation system. This tool indexes all files in the repository according to the specified configuration, processes them into searchable chunks, and stores them in the vector database for future searches.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'The absolute path to the repository directory on the local file system.',
              },
              name: {
                type: 'string',
                description: 'A user-friendly name for the repository. If not provided, the directory name will be used.',
              },
              include: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of glob patterns to include. Default is ["**/*"] (all files).',
              },
              exclude: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of glob patterns to exclude. Default excludes common non-source directories and files.',
              },
              watchMode: {
                type: 'boolean',
                description: 'Whether to watch the repository for changes and automatically update the index. Default is false.',
              },
              watchInterval: {
                type: 'number',
                description: 'Interval in milliseconds to check for changes when watch mode is enabled. Default is 60000 (1 minute).',
              },
              chunkSize: {
                type: 'number',
                description: 'Default maximum size of text chunks in characters. Default is 1000.',
              },
              fileTypeConfig: {
                type: 'object',
                description: 'Configuration for specific file types. Keys are file extensions, values are objects with include, chunkSize, and chunkStrategy properties.',
              },
            },
            required: ['path'],
          },
        } as ToolDefinition,
        {
          name: 'list_repositories',
          description: 'List all local repositories currently indexed in the system. Returns details about each repository including path, include/exclude patterns, and watch mode status.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        } as ToolDefinition,
        {
          name: 'remove_repository',
          description: 'Remove a repository from the system by its name. This removes both the repository configuration and all indexed documents from the vector database.',
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
        } as ToolDefinition,
        {
          name: 'update_repository',
          description: 'Update an existing repository index. This re-processes all files in the repository according to the current configuration and updates the vector database.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the repository to update.',
              },
              include: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of glob patterns to include. If provided, replaces the existing include patterns.',
              },
              exclude: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Array of glob patterns to exclude. If provided, replaces the existing exclude patterns.',
              },
              watchMode: {
                type: 'boolean',
                description: 'Whether to watch the repository for changes. If provided, updates the existing watch mode setting.',
              },
              watchInterval: {
                type: 'number',
                description: 'Interval in milliseconds to check for changes when watch mode is enabled.',
              },
              chunkSize: {
                type: 'number',
                description: 'Default maximum size of text chunks in characters.',
              },
              fileTypeConfig: {
                type: 'object',
                description: 'Configuration for specific file types. If provided, merges with the existing file type configuration.',
              },
            },
            required: ['name'],
          },
        } as ToolDefinition,
        {
          name: 'watch_repository',
          description: 'Start or stop watching a repository for changes. When watching is enabled, the system automatically detects file changes and updates the index accordingly.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the repository to watch or unwatch.',
              },
              action: {
                type: 'string',
                enum: ['start', 'stop'],
                description: 'The action to perform: "start" to begin watching, "stop" to end watching.',
              },
            },
            required: ['name', 'action'],
          },
        } as ToolDefinition,
        {
          name: 'get_indexing_status',
          description: 'Get the current status of repository indexing operations. This tool provides detailed information about ongoing or completed indexing processes, including progress percentage, file counts, and timing information.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Optional. The name of the repository to get status for. If not provided, returns status for all repositories.',
              },
            },
            required: [],
          },
        } as ToolDefinition,
      ],
    }));

    // Register the prompts/list handler
    this.server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      const handler = this.handlers.get('prompts/list');
      if (!handler) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          'Method prompts/list not found'
        );
      }

      // Call the handler but ignore the response
      await handler.handle(request.params);
      // Return an empty list of prompts
      return { prompts: [] };
    });

    // Register the resources/list handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      const handler = this.handlers.get('resources/list');
      if (!handler) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          'Method resources/list not found'
        );
      }

      // Call the handler but ignore the response
      await handler.handle(request.params);
      // Return an empty list of resources
      return { resources: [] };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.apiClient.initCollection(COLLECTION_NAME);

      const handler = this.handlers.get(request.params.name);
      if (!handler) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      // Extract progressToken or use requestId as fallback
      const typedRequest = request as any; // Cast to any to access id
      const callContext = {
        progressToken: typedRequest.params._meta?.progressToken,
        requestId: typedRequest.id
      };

      const response = await handler.handle(typedRequest.params.arguments, callContext);
      return {
        _meta: {}, // Ensure _meta is always present in the response
        ...response
      };
    });
  }
}
