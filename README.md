**Disclaimer:** This project is actively being developed, and contributions are welcome! Feel free to jump in, clean things up, and participate in making it even better.

# RAG Documentation MCP Server
[![smithery badge](https://smithery.ai/badge/@rahulretnan/mcp-ragdocs)](https://smithery.ai/server/@rahulretnan/mcp-ragdocs)

An MCP server implementation that provides tools for retrieving and processing documentation through vector search, enabling AI assistants to augment their responses with relevant documentation context.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Docker Compose Setup](#docker-compose-setup)
- [Web Interface](#web-interface)
- [Configuration](#configuration)
  - [Cline Configuration](#cline-configuration)
  - [Claude Desktop Configuration](#claude-desktop-configuration)
- [Acknowledgments](#acknowledgments)
- [Troubleshooting](#troubleshooting)

## Features

### Tools

1. **search_documentation**
   - Search through the documentation using vector search
   - Returns relevant chunks of documentation with source information
   - Enhanced with LLM processing to confirm relevance and synthesize content
   - Supports JSON or text output formats
   - Optional parameters:
     - `useChain`: Whether to use LLM chain for processing (default: true)
     - `synthesizeFullContent`: Whether to read and synthesize full document content (default: true)
     - `returnFormat`: Format to return results in ('json' or 'text', default: 'json')

2. **list_sources**
   - List all available documentation sources
   - Provides metadata about each source

3. **extract_urls**
   - Extract URLs from text and check if they're already in the documentation
   - Useful for preventing duplicate documentation

4. **remove_documentation**
   - Remove documentation from a specific source
   - Cleans up outdated or irrelevant documentation

5. **list_queue**
   - List all items in the processing queue
   - Shows status of pending documentation processing

6. **run_queue**
   - Process all items in the queue
   - Automatically adds new documentation to the vector store

7. **clear_queue**
   - Clear all items from the processing queue
   - Useful for resetting the system

8. **add_documentation**
   - Add new documentation directly to the system by providing a URL
   - Automatically fetches, processes, and indexes the content
   - Supports various web page formats and extracts relevant content
   - Chunks content intelligently for optimal retrieval
   - Required parameter: `url` (must include protocol, e.g., https://)

9. **local_repository**
   - Adds and indexes a local code repository.
   - Configurable include/exclude patterns, chunking strategies, and optional watch mode.
   - Uses asynchronous processing for large repositories, with progress tracking via `get_indexing_status`.
   - Manages persistent indexing state to avoid re-indexing unchanged files.
   - Required parameter: `path` (absolute or relative path). Optional: `name`, `include`, `exclude`, `watchMode`, `watchInterval`, `chunkSize`, `fileTypeConfig`.

10. **list_repositories** (Enhanced)
    - Lists all configured documentation repositories. This tool has been migrated to the enhanced architecture.
    - Shows include/exclude patterns and watch status

11. **update_repository** (Enhanced)
    - Updates an existing documentation repository configuration and re-indexes its content.
    - This tool has been migrated to the enhanced architecture (`src/tools/update-repository-enhanced.ts`).
    - Can modify include/exclude patterns and other settings.
    - Provides detailed progress logging (heartbeat) to `stderr` during re-indexing.
    - Required parameter: `name` (repository name). Optional: `include`, `exclude`, `watchMode`, `watchInterval`, `chunkSize`, `fileTypeConfig`.

12. **remove_repository** (Enhanced)
    - Removes a configured documentation repository and its indexed documents.
    - This tool has been migrated to the enhanced architecture.
    - Deletes all associated documents from the vector database.
    - Required parameter: `name` (repository name)

13. **watch_repository** (Enhanced)
    - Start or stop watching a configured repository for changes
    - Automatically updates the index when files change using the `update_repository` tool.
    - Required parameters: `name` (repository name) and `action` ("start" or "stop")

14. **get_indexing_status**
    - Get the current status of repository indexing operations
    - Provides detailed information about ongoing or completed indexing processes
    - Shows progress percentage, file counts, and timing information
    - Optional parameter: `name` (repository name) - if not provided, returns status for all repositories


## Quick Start

   - Search through the documentation using vector search
   - Returns relevant chunks of documentation with source information
   - Enhanced with LLM processing to confirm relevance and synthesize content
   - Supports JSON or text output formats
   - Optional parameters:
     - `useChain`: Whether to use LLM chain for processing (default: true)
     - `synthesizeFullContent`: Whether to read and synthesize full document content (default: true)
     - `returnFormat`: Format to return results in ('json' or 'text', default: 'json')

- Enhancing AI responses with relevant documentation
- Building documentation-aware AI assistants
- Creating context-aware tooling for developers
- Implementing semantic documentation search
- Augmenting existing knowledge bases

## Docker Compose Setup

The project includes a `docker-compose.yml` file for easy containerized deployment. To start the services:

```bash
docker-compose up -d
```

To stop the services:

```bash
docker-compose down
```

## Web Interface

The system includes an enhanced web interface (`src/server-enhanced.ts`) that can be accessed after starting the Docker Compose services. This interface has been updated to directly use the enhanced tools from the consolidated architecture.

1. Open your browser and navigate to: `http://localhost:3030`
2. The interface provides:
   - Real-time queue monitoring
   - Documentation source management (URLs and Local Repositories)
   - Search interface for testing queries
   - System status and health checks
   - **Management of Local Repositories** (Add, List, Update, Remove)

## Configuration

When launching the MCP server, the configuration for services like Embeddings and LLMs is primarily controlled by environment variables. There are two main ways these environment variables are provided:

1.  **Direct Launch (.env file)**: When you run the server directly (e.g., using `npm start` or `node build/index.js`), it loads environment variables from the `.env` file at the root of the project directory. This is typically the method used when interacting with the server via the Web Interface.
2.  **MCP Client Configuration**: When the server is launched by an MCP client like Cline or Claude Desktop, the client can provide environment variables through its configuration file (e.g., `cline_mcp_settings.json` or `claude_desktop_config.json`). **Environment variables set in the client's configuration file take precedence over those in the root `.env` file for the server process.**

### Embeddings Configuration

The system uses Ollama as the default embedding provider for local embeddings generation, with OpenAI available as a fallback option. This setup prioritizes local processing while maintaining reliability through cloud-based fallback.

#### Embedding Environment Variables

- `EMBEDDING_PROVIDER`: Choose the primary embedding provider ('ollama' or 'openai', default: 'ollama')
- `EMBEDDING_MODEL`: Specify the model to use (optional)
  - For OpenAI: defaults to 'text-embedding-3-small'
  - For Ollama: defaults to 'nomic-embed-text'
- `OPENAI_API_KEY`: Required when using OpenAI as provider
- `FALLBACK_PROVIDER`: Optional backup provider ('ollama' or 'openai')
- `FALLBACK_MODEL`: Optional model for fallback provider

**Important Note on Model Compatibility**: Ensure that the model name specified for `EMBEDDING_MODEL` and `FALLBACK_MODEL` is compatible with the corresponding `EMBEDDING_PROVIDER` and `FALLBACK_PROVIDER`. Using a model name intended for one provider with a different provider (e.g., `nomic-embed-text` with OpenAI) will cause errors. Refer to the documentation of each provider for valid model names.

### LLM Configuration

The system uses a Large Language Model (LLM) for advanced processing of search results, including relevance confirmation and content synthesis. Like the embedding service, it supports both Ollama (local) and OpenAI (cloud) providers with fallback capabilities.

#### LLM Environment Variables

- `LLM_PROVIDER`: Choose the primary LLM provider ('ollama' or 'openai')
- `LLM_MODEL`: Specify the model to use (optional)
  - For OpenAI: defaults to 'gpt-3.5-turbo'
  - For Ollama: defaults to 'llama3'
- `OPENAI_API_KEY`: Required when using OpenAI as provider (shared with embedding service)
- `LLM_FALLBACK_PROVIDER`: Optional backup provider ('ollama' or 'openai')
- `LLM_FALLBACK_MODEL`: Optional model for fallback provider

### Cline Configuration

When launching the server via Cline, add this to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        // Environment variables set here override those in a root .env file for the server process.
        "EMBEDDING_PROVIDER": "ollama", // default
        "EMBEDDING_MODEL": "nomic-embed-text", // optional
        "LLM_PROVIDER": "ollama", // Change to "mistral" to use Mistral as primary
        "LLM_MODEL": "llama3", // Optional: specify model (e.g., "mistral-small-latest" for Mistral)
        "OPENAI_API_KEY": "your-api-key-here", // required for fallback
        "MISTRAL_API_KEY": "your-mistral-api-key-here", // Required if using Mistral as primary or fallback
        "FALLBACK_PROVIDER": "openai", // recommended for reliability
        "FALLBACK_MODEL": "text-embedding-3-small", // optional
        "LLM_FALLBACK_PROVIDER": "openai", // recommended for reliability
        "LLM_FALLBACK_MODEL": "gpt-3.5-turbo", // optional
        "QDRANT_URL": "http://localhost:6333"
      },
      "disabled": false,
      "autoApprove": [
        "search_documentation",
        "list_sources",
        "extract_urls",
        "remove_documentation",
        "list_queue",
        "run_queue",
        "clear_queue",
        "add_documentation",
        "local_repository",
        "list_repositories",
        "update_repository",
        "remove_repository",
        "watch_repository",
        "get_indexing_status"
      ]
    }
  }
}
```

### Claude Desktop Configuration

When launching the server via Claude Desktop, add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        // Environment variables set here override those in a root .env file for the server process.
        "EMBEDDING_PROVIDER": "ollama", // default
        "EMBEDDING_MODEL": "nomic-embed-text", // optional
        "LLM_PROVIDER": "ollama", // Change to "mistral" to use Mistral as primary
        "LLM_MODEL": "llama3", // Optional: specify model (e.g., "mistral-small-latest" for Mistral)
        "OPENAI_API_KEY": "your-api-key-here", // required for fallback
        "MISTRAL_API_KEY": "your-mistral-api-key-here", // Required if using Mistral as primary or fallback
        "FALLBACK_PROVIDER": "openai", // recommended for reliability
        "FALLBACK_MODEL": "text-embedding-3-small", // optional
        "LLM_FALLBACK_PROVIDER": "openai", // recommended for reliability
        "LLM_FALLBACK_MODEL": "gpt-3.5-turbo", // optional
        "QDRANT_URL": "http://localhost:6333"
      },
      "autoApprove": [
        "search_documentation",
        "list_sources",
        "extract_urls",
        "remove_documentation",
        "list_queue",
        "run_queue",
        "clear_queue",
        "add_documentation",
        "local_repository",
        "list_repositories",
        "update_repository",
        "remove_repository",
        "watch_repository",
        "get_indexing_status"
      ]
    }
  }
}
```

### Default Configuration

The system uses Ollama by default for efficient local embedding generation. For optimal reliability:

1. Install and run Ollama locally
2. Configure OpenAI as fallback (recommended):
   ```json
   {
     // Ollama is used by default for both embedding and LLM
     "EMBEDDING_MODEL": "nomic-embed-text", // optional
     "LLM_MODEL": "llama3", // optional
     "FALLBACK_PROVIDER": "openai",
     "FALLBACK_MODEL": "text-embedding-3-small",
     "LLM_FALLBACK_PROVIDER": "openai",
     "LLM_FALLBACK_MODEL": "gpt-3.5-turbo",
     "OPENAI_API_KEY": "your-api-key-here"
   }
   ```

This configuration ensures:
- Fast, local embedding generation and LLM processing with Ollama
- Automatic fallback to OpenAI if Ollama fails
- No external API calls unless necessary
- Advanced search results with relevance confirmation and content synthesis

Note: The system will automatically use the appropriate vector dimensions based on the provider:
- Ollama (nomic-embed-text): 768 dimensions
- OpenAI (text-embedding-3-small): 1536 dimensions

## Documentation Management

### Direct vs. Queue-Based Documentation Addition

The system provides two complementary approaches for adding documentation:

1. **Direct Addition (`add_documentation` tool)**
   - Immediately processes and indexes the documentation from a URL
   - Best for adding individual documentation sources
   - Provides immediate feedback on processing success/failure
   - Example usage: `add_documentation` with `url: "https://example.com/docs"`

2. **Queue-Based Processing**
   - Add URLs to a processing queue (`extract_urls` with `add_to_queue: true`)
   - Process multiple URLs in batch later (`run_queue`)
   - Better for large-scale documentation ingestion
   - Allows for scheduled processing of many documentation sources
   - Provides resilience through the queue system

Choose the approach that best fits your documentation management needs. For small numbers of important documents, direct addition provides immediate results. For large documentation sets or recursive crawling, the queue-based approach offers better scalability.

### Local Repository Indexing

The system supports indexing local code repositories, making their content searchable alongside web documentation:

1. **Repository Configuration**
   - Define which files to include/exclude using glob patterns
   - Configure chunking strategies per file type
   - Set up automatic change detection with watch mode

2. **File Processing**
   - Files are processed based on their type and language
   - Code is chunked intelligently to preserve context
   - Metadata like file path and language are preserved

3. **Asynchronous Processing**
   - Large repositories are processed asynchronously to avoid MCP timeouts
   - Indexing continues in the background after the initial response
   - Progress can be monitored using the `get_indexing_status` tool
   - Smaller batch sizes (50 chunks per batch) improve responsiveness

4. **Change Detection**
   - Repositories can be watched for changes
   - Modified files are automatically re-indexed
   - Deleted files are removed from the index

Example usage:
```
local_repository with {
  "path": "/path/to/your/repo",
  "name": "my-project",
  "include": ["**/*.js", "**/*.ts", "**/*.md"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "watchMode": true
}
```

After starting the indexing process, you can check its status:
```
get_indexing_status with {
  "name": "my-project"
}
```

This will return detailed information about the indexing progress:
```
Repository: my-project
Status: 🔄 Processing
Progress: 45%
Started: 5/11/2025, 2:45:30 PM
Duration: 3m 15s
Files: 120 processed, 15 skipped (of 250)
Chunks: 1500 indexed (of 3300)
Batch: 15 of 33
```

### Repository Configuration

Repository configurations are stored as individual JSON files in the `repo-configs` directory at the project root. These files are automatically created and managed when you use the repository management tools (add, update, remove).

Each repository configuration file (`repo-configs/<repository-name>.json`) contains the settings for a specific repository:

```json
{
  "path": "/path/to/your/repo",

  "name": "my-project",
  "include": ["**/*.js", "**/*.ts", "**/*.md"],
  "exclude": ["**/node_modules/**", "**/.git/**"],
  "watchMode": true,
  "watchInterval": 60000,
  "chunkSize": 1000,
  "fileTypeConfig": {
    ".js": { "include": true, "chunkStrategy": "semantic" },
    ".ts": { "include": true, "chunkStrategy": "semantic" },
    ".md": { "include": true, "chunkStrategy": "semantic" }
  }
}
```

The `autoWatch` setting is now managed within each individual repository configuration file. If `watchMode` is set to `true` in a repository's config file, the server will automatically start watching that repository at startup.

**Configuration Options:**

- `path`: Absolute path to the repository directory
- `name`: Unique name for the repository
- `include`: Array of glob patterns to include
- `exclude`: Array of glob patterns to exclude
- `watchMode`: Whether to watch for changes (automatically starts watching at startup if true)
- `watchInterval`: Polling interval in milliseconds
- `chunkSize`: Default chunk size for files
- `fileTypeConfig`: Configuration for specific file types
  - `include`: Whether to include this file type
  - `chunkStrategy`: Chunking strategy ("semantic", "line", or "character")
  - `chunkSize`: Optional override for chunk size

## Acknowledgments

This project is a fork of [qpd-v/mcp-ragdocs](https://github.com/qpd-v/mcp-ragdocs), originally developed by qpd-v. The original project provided the foundation for this implementation.

Special thanks to the original creator, qpd-v, for their innovative work on the initial version of this MCP server. This fork has been enhanced with additional features and improvements by Rahul Retnan.

## Troubleshooting

### Server Not Starting (Port Conflict)

If the MCP server fails to start due to a port conflict, follow these steps:

1. Identify and kill the process using port 3030:

```bash
npx kill-port 3030
```

2. Restart the MCP server

3. If the issue persists, check for other processes using the port:

```bash
lsof -i :3030
```

4. You can also change the default port in the configuration if needed
