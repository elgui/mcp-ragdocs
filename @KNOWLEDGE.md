# Knowledge Base for MCP RAG Docs

## Architecture

### Handler Registry
The system uses a handler registry pattern to manage tools. The key components are:

1. **HandlerRegistry Class** (`src/handler-registry.ts`):
   - Manages all tool handlers
   - Registers handlers with the MCP server
   - Defines tool schemas and descriptions

2. **Handler Registration Process**:
   - Handlers are set up in the `setupHandlers` method
   - Tools are exposed to clients via the `ListToolsRequestSchema` handler
   - **Important**: Tools must be included in both places to be available to clients

3. **Tool Definition Structure**:
   ```typescript
   {
     name: 'tool_name',
     description: 'Tool description...',
     inputSchema: {
       type: 'object',
       properties: {
         // Tool parameters
       },
       required: ['param1', 'param2']
     }
   } as ToolDefinition
   ```

## Tools

### Documentation Management Tools

1. **add_documentation**:
   - Directly adds documentation from a URL
   - Processes content immediately
   - Chunks text and creates embeddings
   - Stores in Qdrant vector database
   - Required parameter: `url`

2. **Queue-Based Processing**:
   - `extract_urls`: Extracts URLs from a page
   - `list_queue`: Shows pending URLs
   - `run_queue`: Processes all queued URLs
   - `clear_queue`: Empties the queue

## Client Integration

### Claude Desktop Configuration
Claude Desktop requires explicit configuration to recognize tools:

1. **Tool Registration**: Tools must be properly registered in the server code
2. **Auto-Approval**: Tools must be listed in the `autoApprove` array in the configuration
3. **Configuration File**: Located at `claude_desktop_config.json`

### Common Issues
- Tools registered as handlers but not included in the `ListToolsRequestSchema` response won't appear in clients
- Changes to tool definitions require server restart
- Client applications may cache tool listings, requiring restart

## Troubleshooting

### Missing Tools
If tools are missing from client applications:
1. Check the tool is registered in `setupHandlers`
2. Verify the tool is included in the `tools` array in the `ListToolsRequestSchema` handler
3. Ensure the client configuration includes the tool in any approval lists
4. Restart both server and client applications

### Server Logs
Server logs provide valuable debugging information. MCP servers typically redirect `console.log`, `console.info`, `console.error`, etc., to `stderr` to avoid interfering with the JSON-RPC communication over `stdout`. When troubleshooting or monitoring:
- Check `stderr` output for logs from handlers (e.g., progress during long operations like repository indexing).
- Logs can reveal tool registration issues.
- Client connection details are often logged.
- Request/response patterns can be observed.
- For long-running tools like `add_repository` and `update_repository`:
  - Detailed progress logs are sent to `stderr` to act as a server-side heartbeat.
  - MCP `$/progress` notifications are sent to the client to prevent request timeouts and provide client-side progress updates.
  - **Timeout Issue Solution**: The timeout issue with large repositories has been addressed by implementing asynchronous processing:
    - Repository indexing now runs in the background after initial setup
    - The MCP request returns quickly with a success message, preventing timeout
    - A new `get_indexing_status` tool allows checking the progress of ongoing indexing operations
    - Batch size reduced from 100 to 50 chunks per batch for more frequent progress updates
    - Status tracking implemented via the `IndexingStatusManager` class
    - Detailed status information includes progress percentage, file counts, and timing data

  - **Implementation Details**:
    - Added `IndexingStatus` type to track indexing progress
    - Created `IndexingStatusManager` class to manage status persistence
    - Modified `LocalRepositoryHandler` to use asynchronous processing
    - Added `processRepositoryAsync` method that runs in the background
    - Created `GetIndexingStatusHandler` for checking indexing status
    - Updated documentation to reflect the new asynchronous approach

  - **Additional Improvements**:
    - More robust error handling in batch processing
    - Better progress reporting with detailed status information
    - Status persistence across server restarts
    - Ability to monitor multiple concurrent indexing operations
