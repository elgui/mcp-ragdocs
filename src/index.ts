#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { HandlerRegistry } from "./handler-registry.js";
import { WebInterface } from "./server.js";
import { RepositoryConfigLoader } from "./utils/repository-config-loader.js";

const COLLECTION_NAME = "documentation";

class RagDocsServer {
  private server: Server;
  private apiClient: ApiClient;
  private handlerRegistry: HandlerRegistry;
  private webInterface: WebInterface;
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
    this.webInterface = new WebInterface(this.apiClient);
    this.repoConfigLoader = new RepositoryConfigLoader(this.server, this.apiClient);

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    await this.apiClient.cleanup();
    await this.webInterface.stop();
    await this.server.close();
  }

  async run() {
    try {
      // Redirect console methods to stderr to avoid interfering with JSON-RPC communication
      const originalConsoleLog = console.log;
      const originalConsoleInfo = console.info;
      const originalConsoleWarn = console.warn;
      const originalConsoleError = console.error;

      console.log = (...args) => {
        process.stderr.write(args.map(arg => String(arg)).join(' ') + '\n');
      };
      console.info = (...args) => {
        process.stderr.write(args.map(arg => String(arg)).join(' ') + '\n');
      };
      console.warn = (...args) => {
        process.stderr.write(args.map(arg => String(arg)).join(' ') + '\n');
      };
      console.error = (...args) => {
        process.stderr.write(args.map(arg => String(arg)).join(' ') + '\n');
      };

      // Initialize Qdrant collection
      console.log("Initializing Qdrant collection...");
      await this.apiClient.initCollection(COLLECTION_NAME);
      console.log("Qdrant collection initialized successfully");

      // Start web interface
      await this.webInterface.start();
      console.log("Web interface is running");

      // Load repositories from configuration
      console.log("Loading repositories from configuration...");
      await this.repoConfigLoader.loadRepositories();

      // Start MCP server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.log("RAG Docs MCP server running on stdio");
    } catch (error) {
      process.stderr.write(`Failed to initialize server: ${error}\n`);
      process.exit(1);
    }
  }
}

const server = new RagDocsServer();
server.run().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
