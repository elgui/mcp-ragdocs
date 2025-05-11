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
Server logs provide valuable debugging information:
- Tool registration issues
- Client connection details
- Request/response patterns
