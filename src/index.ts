#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { HandlerRegistry } from "./handler-registry.js";
import { WebInterface } from "./server.js";

const COLLECTION_NAME = "documentation";

class RagDocsServer {
  private server: Server;
  private apiClient: ApiClient;
  private handlerRegistry: HandlerRegistry;
  private webInterface: WebInterface;

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
        },
      }
    );

    this.apiClient = new ApiClient();
    this.handlerRegistry = new HandlerRegistry(this.server, this.apiClient);
    this.webInterface = new WebInterface(this.apiClient);

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
      // Initialize Qdrant collection
      console.log("Initializing Qdrant collection...");
      await this.apiClient.initCollection(COLLECTION_NAME);
      console.log("Qdrant collection initialized successfully");

      // Start web interface
      await this.webInterface.start();
      console.log("Web interface is running");

      // Start MCP server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.log("RAG Docs MCP server running on stdio");
    } catch (error) {
      console.error("Failed to initialize server:", error);
      process.exit(1);
    }
  }
}

const server = new RagDocsServer();
server.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
