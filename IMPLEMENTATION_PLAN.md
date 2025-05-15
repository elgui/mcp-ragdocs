# Implementation Plan: Architecture Consolidation

This document outlines the detailed implementation plan for completing the architecture consolidation in the MCP RAG Docs system.

## Overview

The goal is to consolidate the handlers and tools into a single pattern using enhanced tools. This will eliminate code duplication, improve maintainability, and provide a cleaner architecture.

## Completed Tasks

- [x] Created base infrastructure for consolidated architecture
- [x] Migrated initial tools (SearchDocumentation, ExtractUrls, ListSources, ClearQueue)
- [x] Created documentation (ARCHITECTURE.md, MIGRATION_GUIDE.md)

## Remaining Tasks

### 1. Migrate Remaining Tools

#### Priority 1: Core Functionality
- [ ] **RunQueue** - Handles processing the queue of URLs
  - Create `src/tools/run-queue-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **ListQueue** - Lists URLs in the queue
  - Create `src/tools/list-queue-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **RemoveDocumentation** - Removes documentation from the system
  - Create `src/tools/remove-documentation-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

#### Priority 2: Repository Management
- [ ] **LocalRepository** - Adds a local repository to the system
  - Create `src/tools/local-repository-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **ListRepositories** - Lists repositories in the system
  - Create `src/tools/list-repositories-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **RemoveRepository** - Removes a repository from the system
  - Create `src/tools/remove-repository-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

#### Priority 3: Advanced Repository Features
- [ ] **UpdateRepository** - Updates a repository in the system
  - Create `src/tools/update-repository-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **WatchRepository** - Watches a repository for changes
  - Create `src/tools/watch-repository-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **GetIndexingStatus** - Gets the indexing status of a repository
  - Create `src/tools/get-indexing-status-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

#### Priority 4: Remaining Tools
- [ ] **AddDocumentation** - Adds documentation to the system
  - Create `src/tools/add-documentation-enhanced.ts`
  - Combine functionality from handler and tool versions
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

- [ ] **PromptsListHandler** and **ResourcesListHandler**
  - Create enhanced versions if needed
  - Add to enhanced tools index
  - Register in enhanced handler registry
  - Update enhanced server

### 2. Update Web Interface

- [ ] **Create Enhanced Web Interface**
  - Create `src/server-enhanced.ts` based on `src/server.ts`
  - Update to use enhanced tools directly instead of handlers
  - Add support for new features in enhanced tools

- [ ] **Update Routes**
  - Update each route to use the corresponding enhanced tool
  - Add support for new parameters and features

- [ ] **Add Tests**
  - Create tests for the enhanced web interface
  - Ensure all routes work as expected

### 3. Complete Migration

- [ ] **Remove Duplicate Code**
  - Once all tools are migrated and tested, remove duplicate code
  - Update imports to use enhanced tools

- [ ] **Update Main Server**
  - Update `src/index.ts` to use enhanced architecture by default
  - Rename `src/index-enhanced.ts` to `src/index.ts` (backup original first)

- [ ] **Update Documentation**
  - Update README.md to reflect new architecture
  - Update API documentation
  - Add examples for all enhanced tools

- [ ] **Add Tests**
  - Add tests for all enhanced tools
  - Ensure all functionality works as expected

## Implementation Guidelines

### Code Structure

Each enhanced tool should follow this structure:

```typescript
import { EnhancedBaseTool } from './enhanced-base-tool.js';
import { McpToolResponse } from '../types.js';

export class ExampleEnhancedTool extends EnhancedBaseTool {
  get definition() {
    return {
      name: 'example',
      description: 'Example tool description',
      inputSchema: {
        // Define properties
      },
    };
  }

  async execute(args: any, callContext?: { progressToken?: string | number, requestId: string | number }): Promise<McpToolResponse> {
    // Implementation
    return this.formatTextResponse('Result');
  }
}
```

### Best Practices

1. **Combine Functionality**: Take the best parts of both the handler and tool implementations.
2. **Add New Features**: Consider adding new features that make sense for the tool.
3. **Use Helper Methods**: Use the helper methods provided by `EnhancedBaseTool` for formatting responses.
4. **Only Request Dependencies You Need**: Only specify `withApiClient: true` or `withServer: true` if the tool actually needs them.
5. **Add Documentation**: Document the tool's purpose, parameters, and return values.
6. **Add Tests**: Create tests for the tool to ensure it works as expected.

## Timeline

1. **Week 1**: Migrate core functionality (RunQueue, ListQueue, RemoveDocumentation)
2. **Week 2**: Migrate repository management (LocalRepository, ListRepositories, RemoveRepository)
3. **Week 3**: Migrate advanced repository features (UpdateRepository, WatchRepository, GetIndexingStatus)
4. **Week 4**: Migrate remaining tools and update web interface
5. **Week 5**: Complete migration and add tests

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) - Overview of the new architecture
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Step-by-step guide for migrating tools
- [Enhanced Base Tool](src/tools/enhanced-base-tool.ts) - Base class for enhanced tools
- [Tool Handler Adapter](src/adapters/tool-handler-adapter.ts) - Adapter for backward compatibility
- [Tool Factory](src/adapters/tool-factory.ts) - Factory for creating tools and adapters
- [Enhanced Handler Registry](src/handler-registry-enhanced.ts) - Registry for enhanced tools
