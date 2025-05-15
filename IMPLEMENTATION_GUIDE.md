# Implementation Guide: Consolidating Handlers and Tools

This guide provides step-by-step instructions for implementing the architectural changes outlined in the migration plan.

## Overview

The codebase currently has duplicate functionality between `handlers/` and `tools/` directories. This guide explains how to consolidate them using the enhanced tools pattern.

## Implementation Steps

### 1. Create Required Adapter and Factory Classes

The following files have been created to support the migration:

- `src/adapters/tool-handler-adapter.ts`: Adapter that wraps a tool and exposes it as a handler
- `src/adapters/tool-factory.ts`: Factory for creating tools and adapters
- `src/tools/enhanced-base-tool.ts`: Enhanced base tool class that includes common functionality

### 2. Migrate Each Tool/Handler

For each tool/handler pair, follow these steps:

1. Create a new enhanced tool implementation:
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
     }
   }
   ```

2. Update the handler registry to use the new tool:
   ```typescript
   // In setupTools method
   const exampleTool = this.toolFactory.createTool(ExampleEnhancedTool, { withApiClient: true });
   this.tools.set('example', exampleTool);
   this.handlers.set('example', this.toolFactory.createHandlerAdapter(exampleTool));
   ```

3. Update any direct usage in the WebInterface:
   ```typescript
   // Replace
   this.exampleHandler = new ExampleHandler(this.server, this.apiClient);
   
   // With
   this.exampleTool = new ExampleEnhancedTool({ apiClient: this.apiClient });
   ```

### 3. Gradual Migration Approach

1. Start with one tool/handler pair (e.g., SearchDocumentation)
2. Test thoroughly before proceeding to the next
3. Update references in the codebase as you go
4. Once all pairs are migrated, remove the old implementations

### 4. Testing Strategy

For each migrated tool:

1. Test the tool directly
2. Test through the adapter
3. Test through the API endpoints
4. Compare results with the original implementation

### 5. Rollout Plan

1. Implement the changes in a feature branch
2. Review the changes with the team
3. Merge to the main branch
4. Monitor for any issues

## Example Migration: SearchDocumentation

The SearchDocumentation tool/handler has been migrated as an example:

1. Created `src/tools/search-documentation-enhanced.ts`
2. Updated `src/handler-registry-enhanced.ts` to use the new tool
3. The tool can be used directly or through the adapter

## Next Steps

1. Migrate the remaining tool/handler pairs
2. Update the main application to use the enhanced handler registry
3. Remove the old implementations once everything is working

## Benefits

- Cleaner architecture
- Reduced code duplication
- Clear pattern for adding new functionality
- Better separation of concerns
- Improved maintainability
