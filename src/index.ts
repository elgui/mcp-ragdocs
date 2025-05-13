#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { HandlerRegistry } from "./handler-registry.js";
import { WebInterface } from "./server.js";
import { RepositoryConfigLoader } from "./utils/repository-config-loader.js";
import { info, error } from "./utils/logger.js";

const COLLECTION_NAME = "documentation";

class RagDocsServer {
  private server: Server;
  private apiClient: ApiClient;
  private handlerRegistry: HandlerRegistry;
  private webInterface?: WebInterface; // Make optional as it's initialized in run
  private repoConfigLoader: RepositoryConfigLoader;

  constructor() {
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

    this.apiClient = new ApiClient();
    this.handlerRegistry = new HandlerRegistry(this.server, this.apiClient);
    this.repoConfigLoader = new RepositoryConfigLoader(this.server, this.apiClient);

    // Error handling
    this.server.onerror = (err) => error(`[MCP Error] ${err}`);
    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    await this.apiClient.cleanup();
    if (this.webInterface) { // Check if webInterface was initialized
      await this.webInterface.stop();
    }
    await this.server.close();
  }

  async run() {
    try {
      // Initialize API client, including embedding and LLM services
      await this.apiClient.initialize();

      // Initialize Qdrant collection
      info("Initializing Qdrant collection...");
      await this.apiClient.initCollection(COLLECTION_NAME);
      info("Qdrant collection initialized successfully");

      // Initialize and start web interface after API client is ready
      if (!this.apiClient.llmService) {
         throw new Error("LLM Service not initialized in ApiClient");
      }
      this.webInterface = new WebInterface(this.apiClient, this.apiClient.llmService);
      await this.webInterface.start();
      info("Web interface is running");

      // Load repositories from configuration
      info("Loading repositories from configuration...");
      await this.repoConfigLoader.loadRepositories();

      // Start MCP server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      info("RAG Docs MCP server running on stdio");
    } catch (err) {
      error(`Failed to initialize server: ${err}`);
      process.exit(1);
    }
  }
}

const server = new RagDocsServer();
server.run().catch((err) => {
  error(`Fatal error: ${err}`);
  process.exit(1);
});
