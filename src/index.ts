import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { FacebookAdsMCP } from "./server";
import { AuthkitHandler } from "./authkit-handler";
import { handleApiKeyRequest } from "./api-key-handler";
import type { Env } from "./types";

// Export Durable Objects for Cloudflare Workers
export { FacebookAdsMCP };        // MCP Agent for protocol handling
export { ApifySemaphore } from "./apify-semaphore";  // CRITICAL: Concurrency control

/**
 * Skeleton MCP Server with Dual Authentication Support
 *
 * This MCP server supports TWO authentication methods:
 *
 * 1. OAuth 2.1 (WorkOS AuthKit) - For OAuth-capable clients
 *    - Flow: Client → /authorize → WorkOS → Magic Auth → /callback → Tools
 *    - Used by: Claude Desktop, ChatGPT, OAuth-capable clients
 *    - Endpoints: /authorize, /callback, /token, /register
 *
 * 2. API Key Authentication - For non-OAuth clients
 *    - Flow: Client sends Authorization: Bearer wtyk_XXX → Validate → Tools
 *    - Used by: AnythingLLM, Cursor IDE, custom scripts
 *    - Endpoint: /mcp (with wtyk_ API key in header)
 *
 * MCP Endpoint (supports both auth methods):
 * - /mcp - Streamable HTTP transport (JSON-RPC 2.0 protocol)
 *
 * OAuth Endpoints (OAuth only):
 * - /authorize - Initiates OAuth flow, redirects to WorkOS AuthKit
 * - /callback - Handles OAuth callback from WorkOS
 * - /token - Token endpoint for OAuth clients
 * - /register - Dynamic Client Registration endpoint
 *
 * Available Tools (after authentication):
 * - simpleLookup: Low-cost operation (1 token)
 * - searchAndAnalyze: Consolidated multi-step operation (2 tokens)
 *
 * TODO: Update tool descriptions above to match your actual tools
 */

// Create OAuthProvider instance (used when OAuth authentication is needed)
const oauthProvider = new OAuthProvider({
    // Streamable HTTP transport (JSON-RPC 2.0)
    // This ensures compatibility with all MCP clients (Claude, ChatGPT, etc.)
    apiHandlers: {
        '/mcp': FacebookAdsMCP.serve('/mcp'),
    },

    // OAuth authentication handler (WorkOS AuthKit integration)
    defaultHandler: AuthkitHandler as any,

    // OAuth 2.1 endpoints
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
});

/**
 * Custom fetch handler with dual authentication support
 *
 * This handler detects the authentication method and routes requests accordingly:
 * - API key (wtyk_*) → Direct API key authentication
 * - OAuth token or no auth → OAuth flow via OAuthProvider
 */
export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        try {
            const url = new URL(request.url);
            const authHeader = request.headers.get("Authorization");

            // Check for API key authentication on MCP endpoint
            if (isApiKeyRequest(url.pathname, authHeader)) {
                console.log(`🔐 [Dual Auth] API key request detected: ${url.pathname}`);
                return await handleApiKeyRequest(request, env, ctx);
            }

            // Otherwise, use OAuth flow
            console.log(`🔐 [Dual Auth] OAuth request: ${url.pathname}`);
            return await oauthProvider.fetch(request, env, ctx);

        } catch (error) {
            console.error("[Dual Auth] Error:", error);
            return new Response(
                JSON.stringify({
                    error: "Internal server error",
                    message: error instanceof Error ? error.message : String(error),
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }
    },
};

/**
 * Detect if request should use API key authentication
 *
 * Criteria:
 * 1. Must be the MCP endpoint (/mcp)
 * 2. Must have Authorization header with API key (starts with wtyk_)
 *
 * OAuth endpoints (/authorize, /callback, /token, /register) are NEVER intercepted.
 *
 * @param pathname - Request pathname
 * @param authHeader - Authorization header value
 * @returns true if API key request, false otherwise
 */
function isApiKeyRequest(pathname: string, authHeader: string | null): boolean {
    // Only intercept MCP transport endpoint
    if (pathname !== "/mcp") {
        return false;
    }

    // Check if Authorization header contains API key
    if (!authHeader) {
        return false;
    }

    const token = authHeader.replace("Bearer ", "");
    return token.startsWith("wtyk_");
}
