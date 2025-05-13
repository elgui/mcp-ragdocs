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

### Local Repository Management Tools

1. **watch_repository**:
   - Adds a local repository to be watched and indexed.
   - Required parameter: `path`

2. **list_repositories**:
   - Lists all currently watched local repositories.

3. **remove_repository**:
   - Removes a local repository from the watch list and its indexed documentation.
   - Required parameter: `path`

4. **update_repository**:
   - Triggers an update/re-indexing of a specific local repository.
   - Required parameter: `path`

## Client Integration

### Web Interface
A basic web interface is available at `src/public/index.html` and `src/public/app.js` for interacting with the MCP server. It provides functionality for:
- Adding documentation via URL
- Managing the processing queue
- Searching documentation
- Listing available documents
- **Managing Local Repositories**

### Claude Desktop Configuration
Claude Desktop requires explicit configuration to recognize tools:

1. **Tool Registration**: Tools must be properly registered in the server code
2. **Auto-Approval**: Tools must be listed in the `autoApprove` array in the configuration
3. **Configuration File**: Located at `claude_desktop_config.json`

### Common Issues
- Tools registered as handlers but not included in the `ListToolsRequestSchema` response won't appear in clients
- Changes to tool definitions require server restart
- Client applications may cache tool listings, requiring restart
- **Embedding Encoding Errors**: Addressed potential `TypeError [ERR_UNKNOWN_ENCODING]` during embedding generation by explicitly re-encoding text to UTF-8 using `Buffer.from(text, 'utf-8').toString('utf-8')` in the `generateEmbeddings` methods of `OllamaProvider` and `OpenAIProvider` in `src/services/embeddings.ts`. This aims to normalize text encoding before sending it to the embedding model.
- **Client-side JSON Parsing Errors from Console Output**: `console.info()`, `console.debug()`, and `console.error()` calls in server-side code were causing `SyntaxError: Unexpected token... is not valid JSON` on the client. This is because their output was being sent over the same channel as the expected JSON-RPC messages. To address this, a simple logging utility (`src/utils/logger.ts`) has been implemented to redirect all server-side output, including potential logging errors, to a file (`mcp-ragdocs.log`) in the project root. All direct console calls in the following files have been replaced with calls to this logger:
  - `src/handlers/watch-repository.ts`
  - `src/handlers/run-queue.ts`
  - `src/handlers/update-repository.ts`
  - `src/handlers/list_sources.ts`
  - `src/handlers/list-repositories.ts`
  - `src/utils/repository-config-loader.ts`
  - `src/api-client.ts`
  - `src/utils/file-metadata-manager.ts`
  - `src/tools/run-queue.ts`
  - `src/utils/repository-watcher.ts`
  - `src/services/embeddings.ts`
  - `src/handlers/local-repository.ts`
  - `src/index.ts`

## Troubleshooting

### Embedding Provider Configuration and Model Compatibility
- **Valid Models**: Ensure you are using a valid embedding model name for the configured provider.
    - **Ollama**: Use model names available in your local Ollama instance (e.g., `nomic-embed-text`, `llama2`). You can list available models using `ollama list`.
    - **OpenAI**: Use valid OpenAI embedding model names (e.g., `text-embedding-3-small`, `text-embedding-3-large`).
- **Configuration Mismatch**: Using a model name intended for one provider with a different provider (e.g., `nomic-embed-text` with OpenAI) will cause errors during initialization or embedding generation. Verify that the `EMBEDDING_MODEL` and `FALLBACK_MODEL` environment variables in your client configuration match the `EMBEDDING_PROVIDER` and `FALLBACK_PROVIDER` settings.

### Embedding Service Availability
- Added checks in `src/services/embeddings.ts` to ensure the configured embedding provider (Ollama or OpenAI) is available when the `EmbeddingService` is created. This makes the system more robust against issues with the embedding service not running or being inaccessible. For Ollama, a minimal `ollama.embeddings` call is used as a health check.

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

### LLM Provider Configuration
The primary LLM provider is determined by the `LLM_PROVIDER` environment variable. When the MCP server is launched via a client like Cline or Claude Desktop, environment variables defined in the server's configuration within the client's settings file (e.g., `cline_mcp_settings.json` or `claude_desktop_config.json`) take precedence over environment variables set in the system's environment or a root `.env` file.

If you intend to use a specific LLM provider (e.g., Mistral) as the primary provider, ensure that `LLM_PROVIDER` is set to the desired provider name (e.g., "mistral") within the `env` block of the `rag-docs` server configuration in your client's settings file. Additionally, provide the necessary API key environment variable (e.g., `MISTRAL_API_KEY`) if required by the chosen provider.

Example for `cline_mcp_settings.json` to use Mistral:
```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        // ... other env vars
        "LLM_PROVIDER": "mistral",
        "LLM_MODEL": "mistral-small-latest", // Optional: specify Mistral model
        "MISTRAL_API_KEY": "your-mistral-api-key-here", // Required for Mistral
        // ... fallback and other env vars
      },
      // ... other config
    }
  }
}
```
Remember to replace `"your-mistral-api-key-here"` with your actual Mistral API key.

### Planned Indexing Enhancements

#### Persistent Indexing State and Incremental Updates (In Progress)
- **Objective**: Avoid re-indexing unchanged files on server/client restarts and efficiently update the Qdrant index when source files change.
- **Current Status (Sub-Task 1 Implementation):**
    - **`FileIndexMetadata` Interface**: Defined in `src/types.ts` to structure metadata (includes `filePath`, `fileId`, `repositoryId`, `lastModifiedTimestamp`, `contentHash`).
    - **`FileMetadataManager`**: Implemented in `src/utils/file-metadata-manager.ts`. Manages loading from and saving to `metadata/index_metadata.json`. Provides methods to get, set, and remove metadata. Initializes by creating the metadata file if it doesn't exist.
    - **Core Indexing Logic Modified (`src/handlers/local-repository.ts`)**:
        - **Integration**: `FileMetadataManager` is now used within `processRepository`.
        - **File Hashing & Timestamps**: For each file, its content hash (`crypto.createHash('sha256')`) and last modified timestamp (`fs.stat().mtimeMs`) are obtained.
        - **`fileId` Generation**: A unique `fileId` (hash of `repositoryId:relativePath`) is generated for each file.
        - **Metadata Comparison**:
            - **Unchanged Files**: If current `contentHash` and `lastModifiedTimestamp` match stored metadata for the `fileId`, the file is skipped, and a debug message is logged.
            - **New/Modified Files**: If no metadata exists, or if it differs, the file is processed.
        - **Metadata Update**: After successfully processing a new or modified file (i.e., its content is chunked), its metadata (including the new `contentHash` and `lastModifiedTimestamp`) is saved using `FileMetadataManager.setFileMetadata()`.
        - **`fileId` in Chunks**: The `fileId` is now added to each `DocumentChunk` generated from a file. This is crucial for linking chunks back to their source file for future updates/deletions in Qdrant.
    - **Type Definitions**: `@types/node` installed for Node.js specific types like `process`. Import paths updated to use `.js` extension where necessary (e.g., `../types.js`).
- **Key Components & Flow (Original Plan - parts implemented as above):**
    - **Metadata Storage**:
        - **Implemented**: A persistent store (local JSON file `metadata/index_metadata.json`) maintains metadata for each indexed file.
        - **Implemented**: Metadata includes `filePath`, `lastModifiedTimestamp`, `contentHash`, `repositoryId`, and a unique `fileId`.
    - **Core Indexing Logic Modification**:
        - **Implemented**: On Startup/Repository Scan:
            - `FileMetadataManager.getRepositoryMetadata()` is used to load all existing metadata for the repository.
            - The system iterates through all files found by `glob` in the repository.
            - A `Set` of `fileId`s from the current disk scan (`currentFileIdsOnDisk`) is created.
            - This set is compared against a `Set` of `fileId`s from the loaded metadata (`allKnownFileIdsInRepo`).
            - Files in `allKnownFileIdsInRepo` but not in `currentFileIdsOnDisk` are identified as deleted.
            - For deleted files:
                - A `QDRANT_DELETION_PENDING` warning is logged (actual Qdrant deletion is part of Sub-Task 2).
                - Metadata for the deleted file is removed using `FileMetadataManager.removeFileMetadata()`.
        - **Per File**:
            - **Implemented**: Calculate current `contentHash` and get `lastModifiedTimestamp`.
            - **Comparison with Metadata**:
                - **Implemented**: **Unchanged**: If `contentHash` and `lastModifiedTimestamp` match stored metadata, the file is skipped.
                - **Partially Implemented**: **Modified**: If metadata exists but details differ, the file is marked for update.
                    - **Pending**: Deleting old entries from Qdrant associated with this `fileId`. (Part of Sub-Task 2 - `QDRANT_DELETION_PENDING` log added).
                    - **Implemented**: Re-indexing the new content.
                    - **Implemented**: Updating the metadata entry.
                - **Implemented**: **New**: If no metadata exists for the file, it's indexed as new, and its metadata is stored.
                - **Implemented**: **Deleted (from source)**: If a file in metadata is no longer found in the repository during a scan, its entries are marked for removal from Qdrant (`QDRANT_DELETION_PENDING` log) and its metadata entry is deleted. (Actual Qdrant deletion is part of Sub-Task 2).
    - **Qdrant Integration for Updates (Sub-Task 2 - Pending)**:
        - **Implemented (Prerequisite)**: Qdrant points (vectors) will store the `fileId` in their payload (via `DocumentChunk.fileId`).
        - **Pending**: Implement a function to delete all Qdrant points associated with a specific `fileId` (e.g., `apiClient.deletePointsByFileId(fileId)`).
        - **Pending**: Integrate this deletion logic into the main indexing flow.
    - **Graceful Restarts (Sub-Task 3 - Partially Addressed by Metadata Loading)**:
        - **Implemented (Foundation)**: The system loads metadata on startup via `FileMetadataManager.initialize()`.
        - **Implemented (Foundation)**: The indexing process correctly uses this loaded metadata to avoid re-indexing unchanged files.
        - **Pending**: Full handling of files deleted while the server was offline.
