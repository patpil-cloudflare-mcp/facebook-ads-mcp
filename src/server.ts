import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "./api-client";
import type { Env, SemaphoreSlot } from "./types";
import { ResponseFormat } from "./types";
import type { Props } from "./props";
import { logToolUsage } from "./tokenUtils";
import { ApifyClient } from "./apify-client";
import { getCachedApifyResult, setCachedApifyResult, hashApifyInput } from "./apify-cache";
import { makeAIGatewayRequest, formatAIGatewayError } from "./ai-gateway";

/**
 * TODO: Rename this class to match your server name (e.g., WeatherMCP, NewsMCP, etc.)
 *
 * Skeleton MCP Server with Token Integration
 *
 * This server demonstrates the complete token-based authentication pattern
 * demonstrating the complete authentication pattern.
 *
 * Generic type parameters:
 * - Env: Cloudflare Workers environment bindings (KV, D1, WorkOS credentials, etc.)
 * - unknown: No state management (stateless server) - change if you need state
 * - Props: Authenticated user context from WorkOS (user, tokens, permissions, userId)
 *
 * Authentication flow:
 * 1. User connects via MCP client
 * 2. Redirected to WorkOS AuthKit (Magic Auth)
 * 3. User enters email → receives 6-digit code
 * 4. OAuth callback checks if user exists in token database
 * 5. If not in database → 403 error page
 * 6. If in database → Access granted, user info available via this.props
 * 7. All tools check token balance before execution
 */
export class FacebookAdsMCP extends McpAgent<Env, unknown, Props> {
    server = new McpServer({
        name: "Facebook Ads MCP Server",
        version: "1.0.0",
    });

    // NO initialState - this is a stateless server
    // TODO: If you need state, add:
    // initialState = { yourStateHere: "value" };
    // Then change generic from 'unknown' to your State type

    async init() {
        // ========================================================================
        // Tool 1: analyzeCompetitorStrategy (5 tokens)
        // ========================================================================
        this.server.registerTool(
            "analyzeCompetitorStrategy",
            {
                title: "Analyze Competitor Strategy",
                inputSchema: {
                    facebook_page_url: z.string().describe("Facebook Page URL to analyze (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."),
                    max_ads_to_analyze: z.number().optional().describe("Number of active ads to analyze (1-50). Default: 10. Higher values provide broader strategy insights but increase processing time.")
                },
                outputSchema: {
                    format_statistics: z.object({
                        total: z.number(),
                        video_percentage: z.number(),
                        image_percentage: z.number()
                    }),
                    marketing_hooks: z.object({
                        hooks: z.array(z.string()).optional()
                    }).optional(),
                    metadata: z.object({
                        page_name: z.string().optional(),
                        analysis_date: z.string(),
                        sample_size: z.number()
                    }).optional()
                }
            },
            async (params) => {
                const actionId = crypto.randomUUID();
                const ACTOR_ID = "apify/facebook-ads-scraper";
                const FLAT_COST = 5;
                const TOOL_NAME = "analyzeCompetitorStrategy";
                const TIMEOUT = 120;
                const CACHE_TTL = 21600; // 6 hours

                let slot: SemaphoreSlot | null = null;
                let userId: string | undefined;

                try {
                    // STEP 1: Get User ID
                    userId = this.props?.userId;
                    if (!userId) throw new Error("User ID not found");

                    // Validate Facebook URL
                    const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
                    if (!facebookUrlPattern.test(params.facebook_page_url)) {
                        throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
                    }

                    // STEP 2: Check Cache (CACHE-BEFORE-SEMAPHORE)
                    const actorInput = {
                        startUrls: [{ url: params.facebook_page_url }],
                        resultsLimit: params.max_ads_to_analyze || 10,
                        activeStatus: "active",
                        onlyTotal: false,
                        isDetailsPerAd: true,
                        proxy: { useApifyProxy: true }
                    };
                    const cacheKey = await hashApifyInput({ actorId: ACTOR_ID, input: actorInput });
                    const cached = await getCachedApifyResult<any>(
                        this.env.APIFY_CACHE,
                        ACTOR_ID,
                        cacheKey
                    );

                    if (cached) {
                        console.log(`[Cache HIT] ${TOOL_NAME}`);

                        await logToolUsage(
                            this.env.DB,
                            userId,
                            "facebook-ads-mcp",
                            TOOL_NAME,
                            params,
                            cached,
                            true,
                            actionId
                        );

                        return {
                            content: [{ type: "text", text: JSON.stringify(cached) }],
                            structuredContent: cached
                        };
                    }

                    console.log(`[Cache MISS] ${TOOL_NAME}`);

                    // STEP 3.7: Acquire Semaphore (Only on Cache Miss)
                    const semaphoreId = this.env.APIFY_SEMAPHORE.idFromName("global");
                    const semaphore = this.env.APIFY_SEMAPHORE.get(semaphoreId) as any;
                    slot = await semaphore.acquireSlot(userId, ACTOR_ID);

                    // STEP 4: Execute Apify Actor
                    const apifyClient = new ApifyClient(this.env.APIFY_API_TOKEN);
                    const results = await apifyClient.runActorSync<any>(
                        ACTOR_ID,
                        actorInput,
                        TIMEOUT
                    );

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
                        .slice(0, 10);  // Limit to 10 for AI processing

                    // AI Gateway: Synthesize marketing hooks
                    let marketingHooks: any = { hooks: [] };
                    if (adTexts.length > 0) {
                        const aiResponse = await makeAIGatewayRequest(
                            { gatewayId: this.env.AI_GATEWAY_ID, token: this.env.AI_GATEWAY_TOKEN },
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

                    // Cache result
                    await setCachedApifyResult(
                        this.env.APIFY_CACHE,
                        ACTOR_ID,
                        cacheKey,
                        finalResult,
                        CACHE_TTL
                    );

                    // STEP 4: Log Usage
                    await logToolUsage(
                        this.env.DB,
                        userId,
                        "facebook-ads-mcp",
                        TOOL_NAME,
                        params,
                        finalResult,
                        false,
                        actionId
                    );

                    // STEP 5: Return Result
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(finalResult)
                        }],
                        structuredContent: finalResult
                    };

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`[${TOOL_NAME}] Error:`, errorMessage);
                    return {
                        isError: true,
                        content: [{
                            type: "text",
                            text: `Error: ${errorMessage}`
                        }]
                    };
                } finally {
                    // CRITICAL: Always release semaphore slot
                    if (slot && slot.acquired && userId) {
                        const semaphoreId = this.env.APIFY_SEMAPHORE.idFromName("global");
                        const semaphore = this.env.APIFY_SEMAPHORE.get(semaphoreId) as any;
                        await semaphore.releaseSlot(userId);
                    }
                }
            }
        );

        // ========================================================================
        // Tool 2: fetchCreativeGallery (3 tokens)
        // ========================================================================
        this.server.registerTool(
            "fetchCreativeGallery",
            {
                title: "Fetch Creative Gallery",
                inputSchema: {
                    facebook_page_url: z.string().describe("Facebook Page URL to fetch creatives from (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."),
                    limit: z.number().optional().describe("Number of creative assets to return (1-30). Default: 10. Controls gallery size and response context.")
                },
                outputSchema: {
                    creatives: z.array(z.object({
                        type: z.string(),
                        url: z.url().optional(),
                        thumbnail_url: z.string().optional(),
                        headline: z.string().optional(),
                        body_text: z.string().optional(),
                        cta: z.string().optional()
                    })),
                    metadata: z.object({
                        total_count: z.number(),
                        page_name: z.string(),
                        fetch_date: z.string()
                    }).optional()
                }
            },
            async (params) => {
                const actionId = crypto.randomUUID();
                const ACTOR_ID = "apify/facebook-ads-scraper";
                const FLAT_COST = 3;
                const TOOL_NAME = "fetchCreativeGallery";
                const TIMEOUT = 120;
                const CACHE_TTL = 21600; // 6 hours

                let slot: SemaphoreSlot | null = null;
                let userId: string | undefined;

                try {
                    // STEP 1: Get User ID
                    userId = this.props?.userId;
                    if (!userId) throw new Error("User ID not found");

                    // Validate Facebook URL
                    const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
                    if (!facebookUrlPattern.test(params.facebook_page_url)) {
                        throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
                    }

                    // STEP 2: Check Cache (CACHE-BEFORE-SEMAPHORE)
                    const actorInput = {
                        startUrls: [{ url: params.facebook_page_url }],
                        resultsLimit: params.limit || 10,
                        activeStatus: "active",
                        onlyTotal: false,
                        isDetailsPerAd: true,
                        proxy: { useApifyProxy: true }
                    };
                    const cacheKey = await hashApifyInput({ actorId: ACTOR_ID, input: actorInput });
                    const cached = await getCachedApifyResult<any>(
                        this.env.APIFY_CACHE,
                        ACTOR_ID,
                        cacheKey
                    );

                    if (cached) {
                        console.log(`[Cache HIT] ${TOOL_NAME}`);

                        await logToolUsage(
                            this.env.DB,
                            userId,
                            "facebook-ads-mcp",
                            TOOL_NAME,
                            params,
                            cached,
                            true,
                            actionId
                        );

                        return {
                            content: [{ type: "text", text: JSON.stringify(cached) }],
                            structuredContent: cached
                        };
                    }

                    console.log(`[Cache MISS] ${TOOL_NAME}`);

                    // STEP 3.7: Acquire Semaphore (Only on Cache Miss)
                    const semaphoreId = this.env.APIFY_SEMAPHORE.idFromName("global");
                    const semaphore = this.env.APIFY_SEMAPHORE.get(semaphoreId) as any;
                    slot = await semaphore.acquireSlot(userId, ACTOR_ID);

                    // STEP 4: Execute Apify Actor
                    const apifyClient = new ApifyClient(this.env.APIFY_API_TOKEN);
                    const results = await apifyClient.runActorSync<any>(
                        ACTOR_ID,
                        actorInput,
                        TIMEOUT
                    );

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

                    // Cache result
                    await setCachedApifyResult(
                        this.env.APIFY_CACHE,
                        ACTOR_ID,
                        cacheKey,
                        finalResult,
                        CACHE_TTL
                    );

                    // STEP 4: Log Usage
                    await logToolUsage(
                        this.env.DB,
                        userId,
                        "facebook-ads-mcp",
                        TOOL_NAME,
                        params,
                        finalResult,
                        false,
                        actionId
                    );

                    // STEP 5: Return Result
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(finalResult)
                        }],
                        structuredContent: finalResult
                    };

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`[${TOOL_NAME}] Error:`, errorMessage);
                    return {
                        isError: true,
                        content: [{
                            type: "text",
                            text: `Error: ${errorMessage}`
                        }]
                    };
                } finally {
                    // CRITICAL: Always release semaphore slot
                    if (slot && slot.acquired && userId) {
                        const semaphoreId = this.env.APIFY_SEMAPHORE.idFromName("global");
                        const semaphore = this.env.APIFY_SEMAPHORE.get(semaphoreId) as any;
                        await semaphore.releaseSlot(userId);
                    }
                }
            }
        );

        // ========================================================================
        // Tool 3: checkActivityPulse (1 token)
        // ========================================================================
        this.server.registerTool(
            "checkActivityPulse",
            {
                title: "Check Activity Pulse",
                description: "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use.",
                inputSchema: {
                    facebook_page_url: z.string().describe("Facebook Page URL to check activity for (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required.")
                },
                outputSchema: {
                    is_active: z.boolean(),
                    total_ads: z.number(),
                    page_name: z.string(),
                    last_updated: z.string()
                }
            },
            async (params) => {
                const actionId = crypto.randomUUID();
                const ACTOR_ID = "apify/facebook-ads-scraper";
                const FLAT_COST = 1;
                const TOOL_NAME = "checkActivityPulse";
                const TIMEOUT = 60;
                const CACHE_TTL = 21600; // 6 hours

                let slot: SemaphoreSlot | null = null;
                let userId: string | undefined;

                try {
                    // STEP 1: Get User ID
                    userId = this.props?.userId;
                    if (!userId) throw new Error("User ID not found");

                    // Validate Facebook URL
                    const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
                    if (!facebookUrlPattern.test(params.facebook_page_url)) {
                        throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
                    }

                    // STEP 2: Check Cache (CACHE-BEFORE-SEMAPHORE)
                    const actorInput = {
                        startUrls: [{ url: params.facebook_page_url }],
                        resultsLimit: 1,
                        activeStatus: "active",
                        onlyTotal: true,
                        isDetailsPerAd: false,
                        proxy: { useApifyProxy: true }
                    };
                    const cacheKey = await hashApifyInput({ actorId: ACTOR_ID, input: actorInput });
                    const cached = await getCachedApifyResult<any>(
                        this.env.APIFY_CACHE,
                        ACTOR_ID,
                        cacheKey
                    );

                    if (cached) {
                        console.log(`[Cache HIT] ${TOOL_NAME}`);

                        await logToolUsage(
                            this.env.DB,
                            userId,
                            "facebook-ads-mcp",
                            TOOL_NAME,
                            params,
                            cached,
                            true,
                            actionId
                        );

                        return {
                            content: [{ type: "text", text: JSON.stringify(cached) }],
                            structuredContent: cached
                        };
                    }

                    console.log(`[Cache MISS] ${TOOL_NAME}`);

                    // STEP 3.7: Acquire Semaphore (Only on Cache Miss)
                    const semaphoreId = this.env.APIFY_SEMAPHORE.idFromName("global");
                    const semaphore = this.env.APIFY_SEMAPHORE.get(semaphoreId) as any;
                    slot = await semaphore.acquireSlot(userId, ACTOR_ID);

                    // STEP 4: Execute Apify Actor
                    const apifyClient = new ApifyClient(this.env.APIFY_API_TOKEN);
                    const results = await apifyClient.runActorSync<any>(
                        ACTOR_ID,
                        actorInput,
                        TIMEOUT
                    );

                    const totalCount = results.items?.[0]?.totalCount || 0;
                    const pageName = results.items?.[0]?.pageName || "Unknown";

                    const finalResult = {
                        is_active: totalCount > 0,
                        total_ads: totalCount,
                        page_name: pageName,
                        last_updated: new Date().toISOString()
                    };

                    // Cache result
                    await setCachedApifyResult(
                        this.env.APIFY_CACHE,
                        ACTOR_ID,
                        cacheKey,
                        finalResult,
                        CACHE_TTL
                    );

                    // STEP 4: Log Usage
                    await logToolUsage(
                        this.env.DB,
                        userId,
                        "facebook-ads-mcp",
                        TOOL_NAME,
                        params,
                        finalResult,
                        false,
                        actionId
                    );

                    // STEP 5: Return Result
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(finalResult)
                        }],
                        structuredContent: finalResult
                    };

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`[${TOOL_NAME}] Error:`, errorMessage);
                    return {
                        isError: true,
                        content: [{
                            type: "text",
                            text: `Error: ${errorMessage}`
                        }]
                    };
                } finally {
                    // CRITICAL: Always release semaphore slot
                    if (slot && slot.acquired && userId) {
                        const semaphoreId = this.env.APIFY_SEMAPHORE.idFromName("global");
                        const semaphore = this.env.APIFY_SEMAPHORE.get(semaphoreId) as any;
                        await semaphore.releaseSlot(userId);
                    }
                }
            }
        );
    }
}
