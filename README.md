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

## Quick Start

The RAG Documentation tool is designed for:

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

The system includes a web interface that can be accessed after starting the Docker Compose services:

1. Open your browser and navigate to: `http://localhost:3030`
2. The interface provides:
   - Real-time queue monitoring
   - Documentation source management
   - Search interface for testing queries
   - System status and health checks

## Configuration

### Embeddings Configuration

The system uses Ollama as the default embedding provider for local embeddings generation, with OpenAI available as a fallback option. This setup prioritizes local processing while maintaining reliability through cloud-based fallback.

#### Environment Variables

- `EMBEDDING_PROVIDER`: Choose the primary embedding provider ('ollama' or 'openai', default: 'ollama')
- `EMBEDDING_MODEL`: Specify the model to use (optional)
  - For OpenAI: defaults to 'text-embedding-3-small'
  - For Ollama: defaults to 'nomic-embed-text'
- `OPENAI_API_KEY`: Required when using OpenAI as provider
- `FALLBACK_PROVIDER`: Optional backup provider ('ollama' or 'openai')
- `FALLBACK_MODEL`: Optional model for fallback provider

### Cline Configuration

Add this to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "ollama", // default
        "EMBEDDING_MODEL": "nomic-embed-text", // optional
        "OPENAI_API_KEY": "your-api-key-here", // required for fallback
        "FALLBACK_PROVIDER": "openai", // recommended for reliability
        "FALLBACK_MODEL": "nomic-embed-text", // optional
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
        "add_documentation"
      ]
    }
  }
}
```

### Claude Desktop Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rag-docs": {
      "command": "node",
      "args": ["/path/to/your/mcp-ragdocs/build/index.js"],
      "env": {
        "EMBEDDING_PROVIDER": "ollama", // default
        "EMBEDDING_MODEL": "nomic-embed-text", // optional
        "OPENAI_API_KEY": "your-api-key-here", // required for fallback
        "FALLBACK_PROVIDER": "openai", // recommended for reliability
        "FALLBACK_MODEL": "nomic-embed-text", // optional
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
        "add_documentation"
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
     // Ollama is used by default, no need to specify EMBEDDING_PROVIDER
     "EMBEDDING_MODEL": "nomic-embed-text", // optional
     "FALLBACK_PROVIDER": "openai",
     "FALLBACK_MODEL": "text-embedding-3-small",
     "OPENAI_API_KEY": "your-api-key-here"
   }
   ```

This configuration ensures:
- Fast, local embedding generation with Ollama
- Automatic fallback to OpenAI if Ollama fails
- No external API calls unless necessary

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

### Missing Tools in Claude Desktop

If certain tools (like `add_documentation`) are not appearing in Claude Desktop:

1. Verify that the tool is properly registered in the server's `handler-registry.ts` file
2. Make sure the tool is included in the `ListToolsRequestSchema` handler response
3. Check that your Claude Desktop configuration includes the tool in the `autoApprove` array
4. Restart the Claude Desktop application and the MCP server
5. Check the server logs for any errors related to tool registration

The most common cause of missing tools is that they are registered as handlers but not included in the `tools` array returned by the `ListToolsRequestSchema` handler.
