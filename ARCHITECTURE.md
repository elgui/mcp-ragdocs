# MCP RAG Docs Architecture

## Architectural Overview

The MCP RAG Docs system has been refactored to follow a more consistent and maintainable architecture. This document explains the changes and how to work with the new architecture.

## Previous Architecture Issues

The codebase previously had architectural confusion with duplicate functionality between:
- `src/handlers/` - Classes extending `BaseHandler` with a `handle` method
- `src/tools/` - Classes extending `BaseTool` with `definition` and `execute` methods

This created maintenance issues, code duplication, and confusion about which implementation to use.

## New Architecture

The new architecture consolidates the handlers and tools into a single pattern:

1. **Enhanced Base Tool**: A base class that includes all necessary functionality
   - Located at `src/tools/enhanced-base-tool.ts`
   - Supports optional dependencies (apiClient, server)
   - Provides helper methods for formatting responses

2. **Tool Handler Adapter**: An adapter that wraps a tool and exposes it as a handler
   - Located at `src/adapters/tool-handler-adapter.ts`
   - Provides backward compatibility during migration

3. **Tool Factory**: A factory for creating tools and adapters
   - Located at `src/adapters/tool-factory.ts`
   - Centralizes the creation logic and makes it easier to manage dependencies

4. **Enhanced Handler Registry**: A registry that uses the consolidated pattern
   - Located at `src/handler-registry-enhanced.ts`
   - Manages both tools and handlers

## Migrated Tools

The following tools have been migrated to the new architecture:

1.  **SearchDocumentationEnhancedTool** (`src/tools/search-documentation-enhanced.ts`)
2.  **ExtractUrlsEnhancedTool** (`src/tools/extract-urls-enhanced.ts`)
3.  **ListSourcesEnhancedTool** (`src/tools/list-sources-enhanced.ts`)
4.  **ClearQueueEnhancedTool** (`src/tools/clear-queue-enhanced.ts`)
5.  **RunQueueEnhancedTool** (`src/tools/run-queue-enhanced.ts`)
6.  **RemoveDocumentationEnhancedTool** (`src/tools/remove-documentation-enhanced.ts`)
7.  **ListQueueEnhancedTool** (`src/tools/list-queue-enhanced.ts`)
8.  **AddDocumentationEnhancedTool** (`src/tools/add-documentation-enhanced.ts`)
9.  **LocalRepositoryEnhancedTool** (`src/tools/local-repository-enhanced.ts`)

Each of these enhanced tools replaces its corresponding `Handler` (e.g., `SearchDocumentationHandler`) and `Tool` (e.g., `SearchDocumentationTool`) counterparts from the previous architecture.

## How to Use the New Architecture

### Creating a New Tool

```typescript
// src/tools/example-enhanced.ts
import { EnhancedBaseTool } from './enhanced-base-tool.js';

export class ExampleEnhancedTool extends EnhancedBaseTool {
  get definition() {
    return {
      name: 'example',
      description: 'Example tool',
      inputSchema: {
        // ...
      },
    };
  }
  
  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }) {
    // Implementation
    // Use this.apiClient if needed
    // Use this.server if needed
  }
}
```

### Registering a Tool

```typescript
// In EnhancedHandlerRegistry.setupTools
const exampleTool = this.toolFactory.createTool(ExampleEnhancedTool, { withApiClient: true });
this.tools.set('example', exampleTool);
this.handlers.set('example', this.toolFactory.createHandlerAdapter(exampleTool));
```

### Using a Tool Directly

```typescript
const exampleTool = new ExampleEnhancedTool({ apiClient });
const result = await exampleTool.execute({ /* args */ });
```

The migration to the new architecture is now complete. Duplicate handler and tool files have been removed.

## Running the Server

To run the server with the enhanced architecture:

```bash
node --loader ts-node/esm src/index.ts
```

## Benefits of the New Architecture

1. **Cleaner Architecture**: Clear separation of concerns and consistent patterns
2. **Reduced Duplication**: Eliminates duplicate code between handlers and tools
3. **Improved Maintainability**: Makes it easier to add new functionality and maintain existing code
4. **Better Dependency Management**: Tools only require the dependencies they actually need
5. **Gradual Migration**: Allows for a gradual migration without breaking existing functionality
