#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { EnhancedHandlerRegistry } from "./handler-registry-enhanced.js";
import { WebInterfaceEnhanced } from "./server-enhanced.js"; // Import the new WebInterfaceEnhanced
import { RepositoryConfigLoader } from "./utils/repository-config-loader.js";
import { info, error } from "./utils/logger.js";

const COLLECTION_NAME = "documentation";

/**
 * Enhanced version of the RagDocsServer that uses the consolidated architecture.
 * This demonstrates how to use the enhanced handler registry.
 */
class EnhancedRagDocsServer {
  private server: Server;
  private apiClient: ApiClient;
  private handlerRegistry: EnhancedHandlerRegistry;
  private webInterface?: WebInterfaceEnhanced; // Use WebInterfaceEnhanced type
  private repoConfigLoader: RepositoryConfigLoader;

  constructor() {
    info("EnhancedRagDocsServer constructor started.");
    info("Initializing MCP Server...");
    this.server = new Server(
      {
        name: "mcp-ragdocs",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          prompts: {
            listChanged: false
          },
          resources: {
            listChanged: false
          },
        },
      }
    );
    info("MCP Server initialized.");

    info("Initializing API Client...");
    this.apiClient = new ApiClient();
    info("API Client initialized.");

    info("Initializing EnhancedHandlerRegistry...");
    this.handlerRegistry = new EnhancedHandlerRegistry(this.server, this.apiClient);
    info("EnhancedHandlerRegistry initialized.");

    info("Initializing RepositoryConfigLoader...");
    this.repoConfigLoader = new RepositoryConfigLoader(this.server, this.apiClient);
    info("RepositoryConfigLoader initialized.");

    // Error handling
    this.server.onerror = (err) => error(`[MCP Error] ${err}`);
    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });
    info("EnhancedRagDocsServer constructor finished.");
  }

  private async cleanup() {
    await this.apiClient.cleanup();
    if (this.webInterface) {
      await this.webInterface.stop();
    }
    await this.server.close();
  }

  async run() {
    try {
      info("Starting EnhancedRagDocsServer...");
      // Initialize API client, including embedding and LLM services
      info("Initializing API client...");
      await this.apiClient.initialize();
      info("API client initialized.");

      // Initialize Qdrant collection
      info("Initializing Qdrant collection...");
      await this.apiClient.initCollection(COLLECTION_NAME);
      info("Qdrant collection initialized successfully");

      // Initialize and start web interface after API client is ready
      if (!this.apiClient.llmService) {
         throw new Error("LLM Service not initialized in ApiClient");
      }
      info("Initializing web interface...");
      // Create a web interface that uses the enhanced tools
      this.webInterface = new WebInterfaceEnhanced(this.handlerRegistry, this.apiClient); // Instantiate WebInterfaceEnhanced and pass handlerRegistry and apiClient
      info("Web interface initialized.");

      info("Starting web interface...");
      await this.webInterface.start();
      info("Web interface is running with enhanced tools");

      // Load repositories from configuration
      info("Loading repositories from configuration...");
      await this.repoConfigLoader.loadRepositories();
      info("Repositories loaded.");

      // Start MCP server
      info("Starting MCP server...");
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      info("Enhanced RAG Docs MCP server running on stdio");
      info("EnhancedRagDocsServer started successfully.");
    } catch (err) {
      error(`Failed to initialize server: ${err}`);
      process.exit(1);
    }
  }
}

// Use the enhanced server
info("Instantiating EnhancedRagDocsServer...");
const server = new EnhancedRagDocsServer();
info("EnhancedRagDocsServer instantiated.");
info("Running EnhancedRagDocsServer...");
server.run().catch((err) => {
  error(`Fatal error during server run: ${err}`);
  process.exit(1);
});
info("EnhancedRagDocsServer run method called.");
