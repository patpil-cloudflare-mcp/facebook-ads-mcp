/**
 * API Key Authentication Handler for Skeleton MCP Server
 *
 * This module provides API key authentication support for MCP clients that don't support
 * OAuth flows (like AnythingLLM, Cursor IDE, custom scripts).
 *
 * Authentication flow:
 * 1. Extract API key from Authorization header
 * 2. Validate key using validateApiKey()
 * 3. Get user from database
 * 4. Create MCP server with tools
 * 5. Handle MCP protocol request
 * 6. Return response
 *
 * TODO: When you add new tools to server.ts, you MUST also:
 * 1. Register them in getOrCreateServer() (around line 260)
 * 2. Add tool executor functions (around line 770)
 * 3. Add cases to handleToolsCall() (around line 750)
 * 4. Add tool schemas to handleToolsList() (around line 625)
 */

import { validateApiKey } from "./apiKeys";
import { getUserById } from "./tokenUtils";
import type { Env, ResponseFormat, SemaphoreSlot } from "./types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "./api-client";
import { checkBalance, consumeTokensWithRetry } from "./tokenConsumption";
import { formatInsufficientTokensError, formatAccountDeletedError } from "./tokenUtils";
import { sanitizeOutput, redactPII, validateOutput } from 'pilpat-mcp-security';
import { ApifyClient } from "./apify-client";
import { getCachedApifyResult, setCachedApifyResult, hashApifyInput } from "./apify-cache";
import { makeAIGatewayRequest, formatAIGatewayError } from "./ai-gateway";

/**
 * Simple LRU (Least Recently Used) Cache for MCP Server instances
 *
 * IMPORTANT: This cache is ephemeral and Worker-instance-specific:
 *
 * 🔸 **Ephemeral (Non-Persistent):**
 *   - Cache is cleared when the Worker is evicted from memory
 *   - Eviction can happen at any time (deployments, inactivity, memory pressure)
 *   - NO guarantee of cache persistence between requests
 *
 * 🔸 **Worker-Instance-Specific:**
 *   - Different Worker instances (different data centers) have separate caches
 *   - A user in Warsaw and a user in New York access different caches
 *   - Cache is NOT replicated globally (unlike D1 database)
 *
 * 🔸 **Performance Optimization Only:**
 *   - This is a PERFORMANCE optimization, not critical state storage
 *   - Cache misses simply recreate the MCP server (acceptable overhead)
 *   - Critical state (balances, tokens, transactions) is stored in D1 database
 *
 * 🔸 **Why This Is Safe:**
 *   - MCP servers are stateless (tools query database on each call)
 *   - Recreating a server doesn't cause data loss or corruption
 *   - Token consumption is atomic via D1 transactions (not cached)
 *   - User balances are ALWAYS queried from database (never cached)
 *
 * 🔸 **LRU Eviction:**
 *   - When cache reaches MAX_SIZE, the least recently used server is evicted
 *   - This prevents unbounded memory growth
 *   - Evicted servers are simply garbage collected
 *
 * Reference: Cloudflare Docs - "In-memory state in Durable Objects"
 * https://developers.cloudflare.com/durable-objects/reference/in-memory-state/
 */
class LRUCache<K, V> {
  private cache: Map<K, { value: V; lastAccessed: number }>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get value from cache and update last accessed time
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Update last accessed time (LRU tracking)
      entry.lastAccessed = Date.now();
      return entry.value;
    }
    return undefined;
  }

  /**
   * Set value in cache with automatic LRU eviction
   */
  set(key: K, value: V): void {
    // If cache is full, evict least recently used entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Check if key exists in cache
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Evict least recently used entry from cache
   */
  private evictLRU(): void {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;

    // Find least recently used entry
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      console.log(`🗑️  [LRU Cache] Evicted server for user: ${String(oldestKey)}`);
    }
  }

  /**
   * Clear entire cache (useful for testing)
   */
  clear(): void {
    this.cache.clear();
  }
}

/**
 * Global MCP server cache
 *
 * Configuration:
 * - Max size: 1000 servers (prevents unbounded memory growth)
 * - Eviction policy: LRU (Least Recently Used)
 * - Lifetime: Until Worker is evicted from memory
 *
 * Typical memory usage:
 * - Each MCP server: ~50-100 KB
 * - 1000 servers: ~50-100 MB (acceptable for Workers)
 *
 * Workers have 128 MB memory limit, so 1000 servers leaves plenty of headroom.
 */
const MAX_CACHED_SERVERS = 1000;
const serverCache = new LRUCache<string, McpServer>(MAX_CACHED_SERVERS);

/**
 * Main entry point for API key authenticated MCP requests
 *
 * @param request - Incoming HTTP request
 * @param env - Cloudflare Workers environment
 * @param ctx - Execution context
 * @param pathname - Request pathname (/sse or /mcp)
 * @returns MCP protocol response
 */
export async function handleApiKeyRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string
): Promise<Response> {
  try {
    console.log(`🔐 [API Key Auth] Request to ${pathname}`);

    // 1. Extract API key from Authorization header
    const authHeader = request.headers.get("Authorization");
    const apiKey = authHeader?.replace("Bearer ", "");

    if (!apiKey) {
      console.log("❌ [API Key Auth] Missing Authorization header");
      return jsonError("Missing Authorization header", 401);
    }

    // 2. Validate API key and get user_id
    const userId = await validateApiKey(apiKey, env);

    if (!userId) {
      console.log("❌ [API Key Auth] Invalid or expired API key");
      return jsonError("Invalid or expired API key", 401);
    }

    // 3. Get user from database
    const dbUser = await getUserById(env.TOKEN_DB, userId);

    if (!dbUser) {
      // getUserById already checks is_deleted, so null means not found OR deleted
      console.log(`❌ [API Key Auth] User not found or deleted: ${userId}`);
      return jsonError("User not found or account deleted", 404);
    }

    console.log(
      `✅ [API Key Auth] Authenticated user: ${dbUser.email} (${userId}), balance: ${dbUser.current_token_balance} tokens`
    );

    // 4. Create or get cached MCP server with tools
    const server = await getOrCreateServer(env, userId, dbUser.email);

    // 5. Handle the MCP request using the appropriate transport
    if (pathname === "/sse") {
      return await handleSSETransport(server, request);
    } else if (pathname === "/mcp") {
      return await handleHTTPTransport(server, request, env, userId, dbUser.email);
    } else {
      return jsonError("Invalid endpoint. Use /sse or /mcp", 400);
    }
  } catch (error) {
    console.error("[API Key Auth] Error:", error);
    return jsonError(
      `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
}

/**
 * Get or create MCP server instance for API key user
 *
 * This creates a standalone MCP server (not using McpAgent) with all tools.
 * The server instance is cached per user to avoid recreating it on every request.
 *
 * Cache behavior:
 * - Cache hit: Returns existing server immediately (~1ms)
 * - Cache miss: Creates new server (~10-50ms), then caches it
 * - Cache full: Evicts least recently used server automatically
 *
 * TODO: When you add new tools to server.ts, you MUST add them here too!
 *
 * @param env - Cloudflare Workers environment
 * @param userId - User ID for token management
 * @param email - User email for logging
 * @returns Configured MCP server instance
 */
async function getOrCreateServer(
  env: Env,
  userId: string,
  email: string
): Promise<McpServer> {
  // Check cache first
  const cached = serverCache.get(userId);
  if (cached) {
    console.log(
      `📦 [LRU Cache] HIT for user ${userId} (cache size: ${serverCache.size}/${MAX_CACHED_SERVERS})`
    );
    return cached;
  }

  console.log(
    `🔧 [LRU Cache] MISS for user ${userId} - creating new server (cache size: ${serverCache.size}/${MAX_CACHED_SERVERS})`
  );

  // Create new MCP server
  const server = new McpServer({
    name: "Facebook Ads MCP Server (API Key)",
    version: "1.0.0",
  });

  // ========================================================================
  // API CLIENT INITIALIZATION
  // ========================================================================
  // TODO: Initialize your custom API client here when implementing tools
  // Example: const apiClient = new YourApiClient(env.YOUR_API_KEY);
  // DO NOT uncomment until you have implemented your custom API client class

  // ========================================================================
  // LOCATION 1: TOOL REGISTRATION SECTION
  // ========================================================================
  // Tools will be generated here by the automated boilerplate generator
  // Usage: npm run generate-tool --prp PRPs/your-prp.md --tool-id your_tool --output snippets
  //
  // Or implement tools manually following the 7-Step Token Pattern:
  // Step 0: Generate actionId for idempotency
  // Step 1: userId parameter is already available in this function scope
  // Step 2: Check token balance with checkBalance(env.TOKEN_DB, userId, TOOL_COST)
  // Step 3: Handle insufficient balance and deleted users
  // Step 4: Execute business logic
  // Step 4.5: Apply security (sanitizeOutput + redactPII)
  // Step 5: Consume tokens with consumeTokensWithRetry()
  // Step 6: Return result
  //
  // Tool Description Best Practices (CRITICAL):
  // MUST match descriptions in server.ts exactly (dual-auth consistency).
  //
  // ✅ 3-Part Structure (MANDATORY):
  //    "[Action Verb] [what it does]. " +                           // Part 1: Purpose
  //    "Returns [specific fields]. Use this when [scenario]. " +   // Part 2: Details
  //    "⚠️ Costs X tokens per use."                                 // Part 3: Cost
  //
  // ✅ Security Policy:
  //    - HIDE: API/vendor names (Apify, SerpData, DataForSEO, etc.)
  //    - KEEP: Platform names that are subjects (LinkedIn, Twitter, YouTube)
  //
  // Reference: /TOOL_DESCRIPTION_DESIGN_GUIDE.md for production examples

  // Tool 1: analyzeCompetitorStrategy (5 tokens)
  server.tool(
    "analyzeCompetitorStrategy",
    "Analyze competitor Facebook ad creative strategy to identify format preferences and effective marketing hooks. Returns format statistics (video vs image percentage) and AI-synthesized marketing angles. Use this when you need to understand how a competitor structures their ad campaigns and what messaging resonates. ⚠️ This tool costs 5 tokens per use.",
    {
      facebook_page_url: z.string().describe("Facebook Page URL to analyze (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."),
      max_ads_to_analyze: z.number().optional().describe("Number of active ads to analyze (1-50). Default: 10. Higher values provide broader strategy insights but increase processing time.")
    },
    async (params) => {
      const result = await executeAnalyzeCompetitorStrategyTool(params, env, userId);
      return result;
    }
  );

  // Tool 2: fetchCreativeGallery (3 tokens)
  server.tool(
    "fetchCreativeGallery",
    "Fetch direct URLs to ad images and video thumbnails for visual inspiration. Returns curated list of creative assets with metadata. Use this when you need visual examples of a competitor's ad creatives. ⚠️ This tool costs 3 tokens per use.",
    {
      facebook_page_url: z.string().describe("Facebook Page URL to fetch creatives from (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."),
      limit: z.number().optional().describe("Number of creative assets to return (1-30). Default: 10. Controls gallery size and response context.")
    },
    async (params) => {
      const result = await executeFetchCreativeGalleryTool(params, env, userId);
      return result;
    }
  );

  // Tool 3: checkActivityPulse (1 token)
  server.tool(
    "checkActivityPulse",
    "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use.",
    {
      facebook_page_url: z.string().describe("Facebook Page URL to check activity for (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required.")
    },
    async (params) => {
      const result = await executeCheckActivityPulseTool(params, env, userId);
      return result;
    }
  );

  // Cache the server (automatic LRU eviction if cache is full)
  serverCache.set(userId, server);

  console.log(
    `✅ [LRU Cache] Server created and cached for user ${userId} (cache size: ${serverCache.size}/${MAX_CACHED_SERVERS})`
  );
  return server;
}

/**
 * Handle HTTP (Streamable HTTP) transport for MCP protocol
 *
 * Streamable HTTP is the modern MCP transport protocol that replaced SSE.
 * It uses standard HTTP POST requests with JSON-RPC 2.0 protocol.
 *
 * Supported JSON-RPC methods:
 * - initialize: Protocol handshake and capability negotiation
 * - ping: Health check (required by AnythingLLM)
 * - tools/list: List all available tools
 * - tools/call: Execute a specific tool
 *
 * @param server - Configured MCP server instance
 * @param request - Incoming HTTP POST request with JSON-RPC message
 * @param env - Cloudflare Workers environment
 * @param userId - User ID for logging
 * @param userEmail - User email for logging
 * @returns JSON-RPC response
 */
async function handleHTTPTransport(
  server: McpServer,
  request: Request,
  env: Env,
  userId: string,
  userEmail: string
): Promise<Response> {
  console.log(`📡 [API Key Auth] HTTP transport request from ${userEmail}`);

  try {
    // Parse JSON-RPC request
    const jsonRpcRequest = await request.json() as {
      jsonrpc: string;
      id: number | string;
      method: string;
      params?: any;
    };

    console.log(`📨 [HTTP] Method: ${jsonRpcRequest.method}, ID: ${jsonRpcRequest.id}`);

    // Validate JSON-RPC 2.0 format
    if (jsonRpcRequest.jsonrpc !== "2.0") {
      return jsonRpcResponse(jsonRpcRequest.id, null, {
        code: -32600,
        message: "Invalid Request: jsonrpc must be '2.0'",
      });
    }

    // Route to appropriate handler based on method
    switch (jsonRpcRequest.method) {
      case "initialize":
        return handleInitialize(jsonRpcRequest);

      case "ping":
        return handlePing(jsonRpcRequest);

      case "tools/list":
        return await handleToolsList(server, jsonRpcRequest);

      case "tools/call":
        return await handleToolsCall(server, jsonRpcRequest, env, userId, userEmail);

      default:
        return jsonRpcResponse(jsonRpcRequest.id, null, {
          code: -32601,
          message: `Method not found: ${jsonRpcRequest.method}`,
        });
    }
  } catch (error) {
    console.error("❌ [HTTP] Error:", error);
    return jsonRpcResponse("error", null, {
      code: -32700,
      message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Handle initialize request (MCP protocol handshake)
 */
function handleInitialize(request: {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}): Response {
  console.log("✅ [HTTP] Initialize request");

  return jsonRpcResponse(request.id, {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "Facebook Ads MCP Server",
      version: "1.0.0",
    },
  });
}

/**
 * Handle ping request (health check)
 */
function handlePing(request: {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}): Response {
  console.log("✅ [HTTP] Ping request");

  return jsonRpcResponse(request.id, {});
}

/**
 * Handle tools/list request (list all available tools)
 *
 * TODO: When you add new tools, update this list to match!
 */
async function handleToolsList(
  server: McpServer,
  request: {
    jsonrpc: string;
    id: number | string;
    method: string;
    params?: any;
  }
): Promise<Response> {
  console.log("✅ [HTTP] Tools list request");

  // ========================================================================
  // LOCATION 2: TOOL SCHEMA DEFINITIONS
  // ========================================================================
  // Manually define tools since McpServer doesn't expose listTools()
  // These schemas MUST match the tools registered in getOrCreateServer()
  //
  // TODO: Add tool schemas here when implementing tools
  // Format:
  // {
  //   name: "toolName",
  //   description: "[Action Verb] [what it does]. Returns [fields]. Use this when [scenario]. ⚠️ Costs X tokens.",
  //   inputSchema: {
  //     type: "object",
  //     properties: { /* ... */ },
  //     required: [ /* ... */ ]
  //   }
  // }
  //
  // CRITICAL: Description MUST follow 3-Part Structure and match LOCATION 1 exactly
  const tools: any[] = [
    {
      name: "analyzeCompetitorStrategy",
      description: "Analyze competitor Facebook ad creative strategy to identify format preferences and effective marketing hooks. Returns format statistics (video vs image percentage) and AI-synthesized marketing angles. Use this when you need to understand how a competitor structures their ad campaigns and what messaging resonates. ⚠️ This tool costs 5 tokens per use.",
      inputSchema: {
        type: "object",
        properties: {
          facebook_page_url: {
            type: "string",
            description: "Facebook Page URL to analyze (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."
          },
          max_ads_to_analyze: {
            type: "number",
            description: "Number of active ads to analyze (1-50). Default: 10. Higher values provide broader strategy insights but increase processing time."
          }
        },
        required: ["facebook_page_url"]
      }
    },
    {
      name: "fetchCreativeGallery",
      description: "Fetch direct URLs to ad images and video thumbnails for visual inspiration. Returns curated list of creative assets with metadata. Use this when you need visual examples of a competitor's ad creatives. ⚠️ This tool costs 3 tokens per use.",
      inputSchema: {
        type: "object",
        properties: {
          facebook_page_url: {
            type: "string",
            description: "Facebook Page URL to fetch creatives from (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."
          },
          limit: {
            type: "number",
            description: "Number of creative assets to return (1-30). Default: 10. Controls gallery size and response context."
          }
        },
        required: ["facebook_page_url"]
      }
    },
    {
      name: "checkActivityPulse",
      description: "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use.",
      inputSchema: {
        type: "object",
        properties: {
          facebook_page_url: {
            type: "string",
            description: "Facebook Page URL to check activity for (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."
          }
        },
        required: ["facebook_page_url"]
      }
    }
  ];

  return jsonRpcResponse(request.id, {
    tools,
  });
}

/**
 * Handle tools/call request (execute a tool)
 *
 * TODO: When you add new tools, add cases to the switch statement!
 */
async function handleToolsCall(
  server: McpServer,
  request: {
    jsonrpc: string;
    id: number | string;
    method: string;
    params?: {
      name: string;
      arguments?: Record<string, any>;
    };
  },
  env: Env,
  userId: string,
  userEmail: string
): Promise<Response> {
  if (!request.params || !request.params.name) {
    return jsonRpcResponse(request.id, null, {
      code: -32602,
      message: "Invalid params: name is required",
    });
  }

  const toolName = request.params.name;
  const toolArgs = request.params.arguments || {};

  console.log(`🔧 [HTTP] Tool call: ${toolName} by ${userEmail}`, toolArgs);

  try {
    // Execute tool logic based on tool name
    // This duplicates the logic from getOrCreateServer() but is necessary
    // because McpServer doesn't expose a way to call tools directly

    let result: any;

    // ========================================================================
    // LOCATION 3: TOOL SWITCH CASES
    // ========================================================================
    // Route tool calls to executor functions
    // TODO: Add cases for your tools here!
    //
    // Example:
    // case "yourTool":
    //   result = await executeYourToolTool(toolArgs, env, userId);
    //   break;

    switch (toolName) {
      case "analyzeCompetitorStrategy":
        result = await executeAnalyzeCompetitorStrategyTool(toolArgs, env, userId);
        break;

      case "fetchCreativeGallery":
        result = await executeFetchCreativeGalleryTool(toolArgs, env, userId);
        break;

      case "checkActivityPulse":
        result = await executeCheckActivityPulseTool(toolArgs, env, userId);
        break;

      default:
        return jsonRpcResponse(request.id, null, {
          code: -32601,
          message: `Unknown tool: ${toolName}`,
        });
    }

    console.log(`✅ [HTTP] Tool ${toolName} completed successfully`);

    return jsonRpcResponse(request.id, result);
  } catch (error) {
    console.error(`❌ [HTTP] Tool ${toolName} failed:`, error);
    return jsonRpcResponse(request.id, null, {
      code: -32603,
      message: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// ==============================================================================
// LOCATION 4: TOOL EXECUTOR FUNCTIONS
// ==============================================================================

/**
 * Execute analyzeCompetitorStrategy tool (5 tokens)
 */
async function executeAnalyzeCompetitorStrategyTool(
  args: Record<string, any>,
  env: Env,
  userId: string
): Promise<any> {
  const actionId = crypto.randomUUID();
  const ACTOR_ID = "apify/facebook-ads-scraper";
  const FLAT_COST = 5;
  const TOOL_NAME = "analyzeCompetitorStrategy";
  const TIMEOUT = 120;
  const CACHE_TTL = 21600;

  let slot: SemaphoreSlot | null = null;

  try {
    // Validate Facebook URL
    const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
    if (!facebookUrlPattern.test(args.facebook_page_url)) {
      throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
    }

    // STEP 2: Check Balance
    const balanceCheck = await checkBalance(env.TOKEN_DB, userId, FLAT_COST);

    // STEP 3: Handle Insufficient Balance
    if (!balanceCheck.sufficient) {
      return {
        content: [{
          type: "text",
          text: formatInsufficientTokensError(TOOL_NAME, balanceCheck.currentBalance, FLAT_COST)
        }],
        isError: true
      };
    }

    // STEP 3.5: Check Cache
    const actorInput = {
      startUrls: [{ url: args.facebook_page_url }],
      resultsLimit: args.max_ads_to_analyze || 10,
      activeStatus: "active",
      onlyTotal: false,
      isDetailsPerAd: true,
      proxy: { useApifyProxy: true }
    };
    const cacheKey = await hashApifyInput({ actorId: ACTOR_ID, input: actorInput });
    const cached = await getCachedApifyResult<any>(env.APIFY_CACHE, ACTOR_ID, cacheKey);

    if (cached) {
      console.log(`[Cache HIT] ${TOOL_NAME}`);
      if (FLAT_COST > 0) {
        await consumeTokensWithRetry(
          env.TOKEN_DB,
          userId,
          FLAT_COST,
          "facebook-ads-mcp",
          TOOL_NAME,
          args,
          cached,
          true,
          actionId
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(cached) }] };
    }

    console.log(`[Cache MISS] ${TOOL_NAME}`);

    // STEP 3.7: Acquire Semaphore
    const semaphoreId = env.APIFY_SEMAPHORE.idFromName("global");
    const semaphore = env.APIFY_SEMAPHORE.get(semaphoreId) as any;
    slot = await semaphore.acquireSlot(userId, ACTOR_ID);

    // STEP 4: Execute Apify Actor
    const apifyClient = new ApifyClient(env.APIFY_API_TOKEN);
    const results = await apifyClient.runActorSync<any>(ACTOR_ID, actorInput, TIMEOUT);
    const rawAds = results.items || [];

    // Calculate format statistics
    const videoCount = rawAds.filter((ad: any) => ad.snapshot?.cards?.[0]?.video_hd_url).length;
    const imageCount = rawAds.length - videoCount;
    const formatStats = {
      total: rawAds.length,
      video_percentage: rawAds.length > 0 ? Math.round((videoCount / rawAds.length) * 100) : 0,
      image_percentage: rawAds.length > 0 ? Math.round((imageCount / rawAds.length) * 100) : 0
    };

    // Extract ad texts for AI synthesis
    const adTexts = rawAds
      .map((ad: any) => ad.snapshot?.body?.text)
      .filter((text: string) => text && text.length > 0)
      .slice(0, 10);

    // AI Gateway: Synthesize marketing hooks
    let marketingHooks: any = { hooks: [] };
    if (adTexts.length > 0) {
      const aiResponse = await makeAIGatewayRequest(
        { gatewayId: env.AI_GATEWAY_ID, token: env.AI_GATEWAY_TOKEN },
        "workers-ai",
        "@cf/meta/llama-3-8b-instruct",
        {
          prompt: `Analyze these Facebook ad texts and extract 3 key marketing hooks:\n\n${adTexts.join('\n---\n')}\n\nReturn JSON: {"hooks": ["hook1", "hook2", "hook3"]}`
        },
        3600
      );

      if (aiResponse.success) {
        try {
          marketingHooks = JSON.parse((aiResponse.data as any)?.response || '{"hooks": []}');
        } catch {
          marketingHooks = { hooks: [] };
        }
      }
    }

    // Combine results
    const finalResult = {
      format_statistics: formatStats,
      marketing_hooks: marketingHooks,
      metadata: {
        page_name: rawAds[0]?.pageName || "Unknown",
        analysis_date: new Date().toISOString(),
        sample_size: rawAds.length
      }
    };

    // STEP 4.5: Apply Security
    const sanitized = sanitizeOutput(JSON.stringify(finalResult), {
      maxLength: 10000,
      removeHtml: true,
      removeControlChars: true,
      normalizeWhitespace: true
    });
    const redacted = redactPII(sanitized, {
      redactEmails: false,
      redactPhones: false,
      redactCreditCards: true,
      redactSSN: true,
      redactBankAccounts: true,
      redactPESEL: true,
      redactPolishIdCard: true,
      redactPolishPassport: true,
      redactPolishPhones: false
    });
    const secureResult = JSON.parse(redacted.redacted);

    // Cache result
    await setCachedApifyResult(env.APIFY_CACHE, ACTOR_ID, cacheKey, secureResult, CACHE_TTL);

    // STEP 5: Consume Tokens
    const actualCost = rawAds.length > 0 ? FLAT_COST : 1;
    await consumeTokensWithRetry(
      env.TOKEN_DB,
      userId,
      actualCost,
      "facebook-ads-mcp",
      TOOL_NAME,
      args,
      secureResult,
      false,
      actionId
    );

    // STEP 6: Return Result
    return { content: [{ type: "text", text: JSON.stringify(secureResult) }] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${TOOL_NAME}] Error:`, errorMessage);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true
    };
  } finally {
    if (slot && slot.acquired) {
      const semaphoreId = env.APIFY_SEMAPHORE.idFromName("global");
      const semaphore = env.APIFY_SEMAPHORE.get(semaphoreId) as any;
      await semaphore.releaseSlot(userId);
    }
  }
}

/**
 * Execute fetchCreativeGallery tool (3 tokens)
 */
async function executeFetchCreativeGalleryTool(
  args: Record<string, any>,
  env: Env,
  userId: string
): Promise<any> {
  const actionId = crypto.randomUUID();
  const ACTOR_ID = "apify/facebook-ads-scraper";
  const FLAT_COST = 3;
  const TOOL_NAME = "fetchCreativeGallery";
  const TIMEOUT = 120;
  const CACHE_TTL = 21600;

  let slot: SemaphoreSlot | null = null;

  try {
    // Validate Facebook URL
    const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
    if (!facebookUrlPattern.test(args.facebook_page_url)) {
      throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
    }

    // STEP 2: Check Balance
    const balanceCheck = await checkBalance(env.TOKEN_DB, userId, FLAT_COST);

    // STEP 3: Handle Insufficient Balance
    if (!balanceCheck.sufficient) {
      return {
        content: [{
          type: "text",
          text: formatInsufficientTokensError(TOOL_NAME, balanceCheck.currentBalance, FLAT_COST)
        }],
        isError: true
      };
    }

    // STEP 3.5: Check Cache
    const actorInput = {
      startUrls: [{ url: args.facebook_page_url }],
      resultsLimit: args.limit || 10,
      activeStatus: "active",
      onlyTotal: false,
      isDetailsPerAd: true,
      proxy: { useApifyProxy: true }
    };
    const cacheKey = await hashApifyInput({ actorId: ACTOR_ID, input: actorInput });
    const cached = await getCachedApifyResult<any>(env.APIFY_CACHE, ACTOR_ID, cacheKey);

    if (cached) {
      console.log(`[Cache HIT] ${TOOL_NAME}`);
      if (FLAT_COST > 0) {
        await consumeTokensWithRetry(
          env.TOKEN_DB,
          userId,
          FLAT_COST,
          "facebook-ads-mcp",
          TOOL_NAME,
          args,
          cached,
          true,
          actionId
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(cached) }] };
    }

    console.log(`[Cache MISS] ${TOOL_NAME}`);

    // STEP 3.7: Acquire Semaphore
    const semaphoreId = env.APIFY_SEMAPHORE.idFromName("global");
    const semaphore = env.APIFY_SEMAPHORE.get(semaphoreId) as any;
    slot = await semaphore.acquireSlot(userId, ACTOR_ID);

    // STEP 4: Execute Apify Actor
    const apifyClient = new ApifyClient(env.APIFY_API_TOKEN);
    const results = await apifyClient.runActorSync<any>(ACTOR_ID, actorInput, TIMEOUT);
    const rawAds = results.items || [];

    // Extract creative assets
    const creatives = rawAds.map((ad: any) => {
      const card = ad.snapshot?.cards?.[0];
      const isVideo = !!card?.video_hd_url;

      return {
        type: isVideo ? "video" : "image",
        url: isVideo ? card.video_hd_url : card?.originalImageUrl,
        thumbnail_url: card?.originalImageUrl,
        headline: ad.snapshot?.title || "",
        body_text: ad.snapshot?.body?.text || "",
        cta: ad.snapshot?.ctaText || ""
      };
    }).filter((creative: any) => creative.url);

    const finalResult = {
      creatives: creatives,
      metadata: {
        total_count: creatives.length,
        page_name: rawAds[0]?.pageName || "Unknown",
        fetch_date: new Date().toISOString()
      }
    };

    // STEP 4.5: Apply Security
    const sanitized = sanitizeOutput(JSON.stringify(finalResult), {
      maxLength: 10000,
      removeHtml: true,
      removeControlChars: true,
      normalizeWhitespace: true
    });
    const redacted = redactPII(sanitized, {
      redactEmails: false,
      redactPhones: false,
      redactCreditCards: true,
      redactSSN: true,
      redactBankAccounts: true,
      redactPESEL: true,
      redactPolishIdCard: true,
      redactPolishPassport: true,
      redactPolishPhones: false
    });
    const secureResult = JSON.parse(redacted.redacted);

    // Cache result
    await setCachedApifyResult(env.APIFY_CACHE, ACTOR_ID, cacheKey, secureResult, CACHE_TTL);

    // STEP 5: Consume Tokens
    const actualCost = creatives.length > 0 ? FLAT_COST : 1;
    await consumeTokensWithRetry(
      env.TOKEN_DB,
      userId,
      actualCost,
      "facebook-ads-mcp",
      TOOL_NAME,
      args,
      secureResult,
      false,
      actionId
    );

    // STEP 6: Return Result
    return { content: [{ type: "text", text: JSON.stringify(secureResult) }] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${TOOL_NAME}] Error:`, errorMessage);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true
    };
  } finally {
    if (slot && slot.acquired) {
      const semaphoreId = env.APIFY_SEMAPHORE.idFromName("global");
      const semaphore = env.APIFY_SEMAPHORE.get(semaphoreId) as any;
      await semaphore.releaseSlot(userId);
    }
  }
}

/**
 * Execute checkActivityPulse tool (1 token)
 */
async function executeCheckActivityPulseTool(
  args: Record<string, any>,
  env: Env,
  userId: string
): Promise<any> {
  const actionId = crypto.randomUUID();
  const ACTOR_ID = "apify/facebook-ads-scraper";
  const FLAT_COST = 1;
  const TOOL_NAME = "checkActivityPulse";
  const TIMEOUT = 60;
  const CACHE_TTL = 21600;

  let slot: SemaphoreSlot | null = null;

  try {
    // Validate Facebook URL
    const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
    if (!facebookUrlPattern.test(args.facebook_page_url)) {
      throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
    }

    // STEP 2: Check Balance
    const balanceCheck = await checkBalance(env.TOKEN_DB, userId, FLAT_COST);

    // STEP 3: Handle Insufficient Balance
    if (!balanceCheck.sufficient) {
      return {
        content: [{
          type: "text",
          text: formatInsufficientTokensError(TOOL_NAME, balanceCheck.currentBalance, FLAT_COST)
        }],
        isError: true
      };
    }

    // STEP 3.5: Check Cache
    const actorInput = {
      startUrls: [{ url: args.facebook_page_url }],
      resultsLimit: 1,
      activeStatus: "active",
      onlyTotal: true,
      isDetailsPerAd: false,
      proxy: { useApifyProxy: true }
    };
    const cacheKey = await hashApifyInput({ actorId: ACTOR_ID, input: actorInput });
    const cached = await getCachedApifyResult<any>(env.APIFY_CACHE, ACTOR_ID, cacheKey);

    if (cached) {
      console.log(`[Cache HIT] ${TOOL_NAME}`);
      if (FLAT_COST > 0) {
        await consumeTokensWithRetry(
          env.TOKEN_DB,
          userId,
          FLAT_COST,
          "facebook-ads-mcp",
          TOOL_NAME,
          args,
          cached,
          true,
          actionId
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(cached) }] };
    }

    console.log(`[Cache MISS] ${TOOL_NAME}`);

    // STEP 3.7: Acquire Semaphore
    const semaphoreId = env.APIFY_SEMAPHORE.idFromName("global");
    const semaphore = env.APIFY_SEMAPHORE.get(semaphoreId) as any;
    slot = await semaphore.acquireSlot(userId, ACTOR_ID);

    // STEP 4: Execute Apify Actor
    const apifyClient = new ApifyClient(env.APIFY_API_TOKEN);
    const results = await apifyClient.runActorSync<any>(ACTOR_ID, actorInput, TIMEOUT);

    const totalCount = results.items?.[0]?.totalCount || 0;
    const pageName = results.items?.[0]?.pageName || "Unknown";

    const finalResult = {
      is_active: totalCount > 0,
      total_ads: totalCount,
      page_name: pageName,
      last_updated: new Date().toISOString()
    };

    // STEP 4.5: Apply Security
    const sanitized = sanitizeOutput(JSON.stringify(finalResult), {
      maxLength: 1000,
      removeHtml: true,
      removeControlChars: true,
      normalizeWhitespace: true
    });
    const redacted = redactPII(sanitized, {
      redactEmails: false,
      redactPhones: false,
      redactCreditCards: true,
      redactSSN: true,
      redactBankAccounts: true,
      redactPESEL: true,
      redactPolishIdCard: true,
      redactPolishPassport: true,
      redactPolishPhones: false
    });
    const secureResult = JSON.parse(redacted.redacted);

    // Cache result
    await setCachedApifyResult(env.APIFY_CACHE, ACTOR_ID, cacheKey, secureResult, CACHE_TTL);

    // STEP 5: Consume Tokens
    const actualCost = FLAT_COST;
    await consumeTokensWithRetry(
      env.TOKEN_DB,
      userId,
      actualCost,
      "facebook-ads-mcp",
      TOOL_NAME,
      args,
      secureResult,
      false,
      actionId
    );

    // STEP 6: Return Result
    return { content: [{ type: "text", text: JSON.stringify(secureResult) }] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${TOOL_NAME}] Error:`, errorMessage);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true
    };
  } finally {
    if (slot && slot.acquired) {
      const semaphoreId = env.APIFY_SEMAPHORE.idFromName("global");
      const semaphore = env.APIFY_SEMAPHORE.get(semaphoreId) as any;
      await semaphore.releaseSlot(userId);
    }
  }
}

// ==============================================================================
// JSON-RPC & UTILITY FUNCTIONS
// ==============================================================================

/**
 * Create a JSON-RPC 2.0 response
 */
function jsonRpcResponse(
  id: number | string,
  result: any = null,
  error: { code: number; message: string } | null = null
): Response {
  const response: any = {
    jsonrpc: "2.0",
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Handle SSE (Server-Sent Events) transport for MCP protocol
 *
 * SSE is used by AnythingLLM and other clients for real-time MCP communication.
 * This uses the standard MCP SDK SSEServerTransport for Cloudflare Workers.
 *
 * @param server - Configured MCP server instance
 * @param request - Incoming HTTP request
 * @returns SSE response stream
 */
async function handleSSETransport(server: McpServer, request: Request): Promise<Response> {
  console.log("📡 [API Key Auth] Setting up SSE transport");

  try {
    // For Cloudflare Workers, we need to return a Response with a ReadableStream
    // The MCP SDK's SSEServerTransport expects Node.js streams, so we'll implement
    // SSE manually for Cloudflare Workers compatibility

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send SSE headers
    const response = new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });

    // Connect server to client (handle in background)
    // Note: This is a simplified implementation for API key auth
    // Full SSE support would require handling POST messages from client

    (async () => {
      try {
        // Send initial connection event
        await writer.write(encoder.encode("event: message\n"));
        await writer.write(encoder.encode('data: {"status":"connected"}\n\n'));

        console.log("✅ [API Key Auth] SSE connection established");

        // Keep connection alive
        const keepAliveInterval = setInterval(async () => {
          try {
            await writer.write(encoder.encode(": keepalive\n\n"));
          } catch (e) {
            clearInterval(keepAliveInterval);
          }
        }, 30000);

        // Note: Full MCP protocol implementation would go here
        // For MVP, we're providing basic SSE connectivity
      } catch (error) {
        console.error("❌ [API Key Auth] SSE error:", error);
        await writer.close();
      }
    })();

    return response;
  } catch (error) {
    console.error("❌ [API Key Auth] SSE transport error:", error);
    throw error;
  }
}

/**
 * Helper function to return JSON error responses
 *
 * @param message - Error message
 * @param status - HTTP status code
 * @returns JSON error response
 */
function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: message,
      status: status,
    }),
    {
      status: status,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}
