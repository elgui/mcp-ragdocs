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
import { ToolFactory } from './adapters/tool-factory.js';
import {
  SearchDocumentationEnhancedTool,
  ExtractUrlsEnhancedTool,
  ListSourcesEnhancedTool,
  ClearQueueEnhancedTool,
  RunQueueEnhancedTool,
  RemoveDocumentationEnhancedTool,
  ListQueueEnhancedTool,
  AddDocumentationEnhancedTool, // Import the new tool
  LocalRepositoryEnhancedTool,
  ListRepositoriesEnhancedTool,
  RemoveRepositoryEnhancedTool,
  UpdateRepositoryEnhancedTool, // Import the new tool
  WatchRepositoryEnhancedTool, // Import the new tool
  GetIndexingStatusEnhancedTool // Import the new tool
} from './tools/enhanced-tools.js';
import { PromptsListHandler } from './handlers/prompts-list.js';
import { ResourcesListHandler } from './handlers/resources-list.js';

const COLLECTION_NAME = 'documentation';

/**
 * Enhanced handler registry that uses the consolidated tool pattern.
 * This demonstrates how to migrate the handler registry to use the new pattern.
 */
export class EnhancedHandlerRegistry {
  private server: Server;
  private apiClient: ApiClient;
  private toolFactory: ToolFactory;
  private handlers: Map<string, any>;
  private tools: Map<string, any>;

  constructor(server: Server, apiClient: ApiClient) {
    this.server = server;
    this.apiClient = apiClient;
    this.toolFactory = new ToolFactory(server, apiClient);
    this.handlers = new Map();
    this.tools = new Map();
    this.setupTools();
    this.registerHandlers();
  }

  private setupTools() {
    // Create tools using the factory
    const searchDocTool = this.toolFactory.createTool(SearchDocumentationEnhancedTool, { withApiClient: true });
    const extractUrlsTool = this.toolFactory.createTool(ExtractUrlsEnhancedTool, { withApiClient: true });
    const listSourcesTool = this.toolFactory.createTool(ListSourcesEnhancedTool, { withApiClient: true });
    const clearQueueTool = this.toolFactory.createTool(ClearQueueEnhancedTool);
    const removeDocumentationTool = this.toolFactory.createTool(RemoveDocumentationEnhancedTool, { withApiClient: true });
    const addDocumentationTool = this.toolFactory.createTool(AddDocumentationEnhancedTool, { withApiClient: true }); // Create the new tool
    const localRepositoryTool = this.toolFactory.createTool(LocalRepositoryEnhancedTool, { withApiClient: true, withServer: true });
    const listRepositoriesTool = this.toolFactory.createTool(ListRepositoriesEnhancedTool); // Create the new tool;

    const removeRepositoryTool = this.toolFactory.createTool(RemoveRepositoryEnhancedTool, { withApiClient: true, withServer: true });
    this.tools.set('remove_repository', removeRepositoryTool);
    this.handlers.set('remove_repository', this.toolFactory.createHandlerAdapter(removeRepositoryTool));

    // Create and register the new enhanced tool
    const updateRepositoryTool = this.toolFactory.createTool(UpdateRepositoryEnhancedTool, { withApiClient: true, withServer: true });
    this.tools.set('update_repository', updateRepositoryTool);
    this.handlers.set('update_repository', this.toolFactory.createHandlerAdapter(updateRepositoryTool));

    // Create and register the WatchRepositoryEnhancedTool
    const watchRepositoryTool = this.toolFactory.createTool(WatchRepositoryEnhancedTool, { withApiClient: true, withServer: true });
    this.tools.set('watch_repository', watchRepositoryTool);
    this.handlers.set('watch_repository', this.toolFactory.createHandlerAdapter(watchRepositoryTool));

    // Create and register the GetIndexingStatusEnhancedTool
    const getIndexingStatusTool = this.toolFactory.createTool(GetIndexingStatusEnhancedTool);
    this.tools.set('get_indexing_status', getIndexingStatusTool);
    this.handlers.set('get_indexing_status', this.toolFactory.createHandlerAdapter(getIndexingStatusTool));

    // Store tools for direct access
    this.tools.set('search_documentation', searchDocTool);
    this.tools.set('extract_urls', extractUrlsTool);
    this.tools.set('list_sources', listSourcesTool);
    this.tools.set('clear_queue', clearQueueTool);
    this.tools.set('remove_documentation', removeDocumentationTool);
    this.tools.set('add_documentation', addDocumentationTool); // Add the new tool
    this.tools.set('local_repository', localRepositoryTool);
    this.tools.set('list_repositories', listRepositoriesTool); // Add the new tool

    // Create handler adapters for backward compatibility
    this.handlers.set('search_documentation', this.toolFactory.createHandlerAdapter(searchDocTool));
    this.handlers.set('extract_urls', this.toolFactory.createHandlerAdapter(extractUrlsTool));
    this.handlers.set('list_sources', this.toolFactory.createHandlerAdapter(listSourcesTool));
    this.handlers.set('clear_queue', this.toolFactory.createHandlerAdapter(clearQueueTool));
    this.handlers.set('remove_documentation', this.toolFactory.createHandlerAdapter(removeDocumentationTool));
    this.handlers.set('add_documentation', this.toolFactory.createHandlerAdapter(addDocumentationTool)); // Add the new handler adapter
    this.handlers.set('local_repository', this.toolFactory.createHandlerAdapter(localRepositoryTool));
    this.handlers.set('list_repositories', this.toolFactory.createHandlerAdapter(listRepositoriesTool));

    // Register the new enhanced tool
    const runQueueTool = this.toolFactory.createTool(RunQueueEnhancedTool, { withApiClient: true, withServer: true });
    this.tools.set('run_queue', runQueueTool);
    this.handlers.set('run_queue', this.toolFactory.createHandlerAdapter(runQueueTool));

    // Register ListQueueEnhancedTool
    const listQueueTool = this.toolFactory.createTool(ListQueueEnhancedTool);
    this.tools.set('list_queue', listQueueTool);
    this.handlers.set('list_queue', this.toolFactory.createHandlerAdapter(listQueueTool));

    // Legacy handlers that haven't been migrated yet
    this.handlers.set('prompts/list', new PromptsListHandler(this.server, this.apiClient));
    this.handlers.set('resources/list', new ResourcesListHandler(this.server, this.apiClient));

    // Note: Add more tools and handlers as they are migrated
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Get tool definitions directly from the tools
        this.tools.get('search_documentation')?.definition,
        this.tools.get('extract_urls')?.definition,
        this.tools.get('remove_documentation')?.definition,
        this.tools.get('list_queue')?.definition,
        this.tools.get('add_documentation')?.definition, // Add the new tool definition
        this.tools.get('local_repository')?.definition,
        this.tools.get('list_repositories')?.definition,
        this.tools.get('update_repository')?.definition, // Add the new tool definition
        this.tools.get('watch_repository')?.definition, // Add the new tool definition
        this.tools.get('get_indexing_status')?.definition, // Add the new tool definition
        // Add more tool definitions as they are migrated
      ].filter(Boolean), // Filter out any undefined tools
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

      const toolName = request.params.name;

      // Try to get the tool first
      const tool = this.tools.get(toolName);
      if (tool) {
        // Extract progressToken or use requestId as fallback
        const typedRequest = request as any; // Cast to any to access id
        const callContext = {
          progressToken: typedRequest.params._meta?.progressToken,
          requestId: typedRequest.id
        };

        const response = await tool.execute(typedRequest.params.arguments, callContext);
        return {
          _meta: {}, // Ensure _meta is always present in the response
          ...response
        };
      }

      // Fall back to handler if tool not found
      const handler = this.handlers.get(toolName);
      if (handler) {
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
      }

      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${toolName}`
      );
    });
  }

  /**
   * Get a tool by name.
   * This allows direct access to tools from other parts of the application.
   */
  getTool(name: string) {
    return this.tools.get(name);
  }

  /**
   * Get a handler by name.
   * This allows direct access to handlers from other parts of the application.
   */
  getHandler(name: string) {
    return this.handlers.get(name);
  }
}
