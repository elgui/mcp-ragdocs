# Migration Plan: Consolidating Handlers and Tools

## Current Architecture Issues

The codebase currently has architectural confusion with duplicate functionality between:
- `src/handlers/` - Classes extending `BaseHandler` with a `handle` method
- `src/tools/` - Classes extending `BaseTool` with `definition` and `execute` methods

This creates maintenance issues, code duplication, and confusion about which implementation to use.

## Proposed Solution

We will consolidate the architecture by:
1. Adopting the `tools` pattern as the primary implementation
2. Migrating all handlers to tools
3. Implementing an adapter pattern for backward compatibility

## Migration Steps

### 1. Create a Unified Tool Base Class

- Enhance `BaseTool` to include all necessary functionality
- Ensure it can handle all use cases from both patterns

### 2. Create an Adapter for Backward Compatibility

- Create a `ToolHandler` adapter that wraps a `BaseTool` and exposes a `handle` method
- This allows existing code to continue working during migration

### 3. Migrate Each Handler to a Tool Implementation

For each handler:
- Create or update the corresponding tool implementation
- Ensure all functionality is preserved
- Use the adapter to maintain backward compatibility

### 4. Update Registration and Usage

- Update `HandlerRegistry` to work with the new pattern
- Update `WebInterface` to use the consolidated implementations

### 5. Clean Up

- Remove duplicate code
- Update documentation
- Update tests

## Benefits

- Cleaner architecture
- Reduced code duplication
- Clear pattern for adding new functionality
- Better separation of concerns
- Improved maintainability
