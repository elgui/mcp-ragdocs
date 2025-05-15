#!/bin/bash
# Script to run the enhanced version of the server

# Compile TypeScript
echo "Compiling TypeScript..."
npx tsc

# Run the enhanced server
echo "Starting enhanced server..."
node --loader ts-node/esm src/index-enhanced.ts
