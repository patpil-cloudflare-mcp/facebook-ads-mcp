# PRP: Facebook Competitive Intelligence MCP

## Mission

Implement production-ready Cloudflare McpAgent server with Apify integration for Facebook Ad Library competitive intelligence. AI-powered strategic analysis with format aggregation, cache-before-semaphore optimization, and variable token consumption.

---

## 1. Executive Summary

Facebook Competitive Intelligence MCP scrapes Facebook Ad Library data via Apify and synthesizes it into strategic insights using Cloudflare Workers AI. Instead of raw data dumps, the server provides processed intelligence: format statistics (video vs image ratios), AI-extracted marketing hooks, and sorted creative galleries. Pay-per-result pricing with extended cache (6 hours) maximizes profit margins for competitive intelligence use cases where data changes slowly.

## 2. System Architecture

**Canonical Pattern**: `/patterns/apify-7-step.md` (Complete 7-step implementation)

**Quick Reference**:
- Cache-before-semaphore (Steps 3.5 → 3.7) → 50-70% cost savings
- ApifySemaphore: 32 concurrent slots, 60s timeout
- KV Cache: **21600s TTL (6 hours)** - extended for competitive intelligence
- Flat pricing: Charge on success, 0 on failure
- Single-item design: One Facebook Page per call
- Security: Step 4.5 (sanitizeOutput + redactPII)

**AI Gateway Integration**: `/patterns/ai-gateway.md` (Required for strategy synthesis)
- Gateway ID: `mcp-apify-gateway` (shared)
- Model: `@cf/meta/llama-3-8b-instruct`
- Use Case: Post-processing/synthesis of ad texts into marketing hooks
- Cache TTL: 3600s (1 hour) for AI analysis

---

## 3. Goal & Success Definition

**Feature Goal**: Automate competitive intelligence analysis of Facebook Ads by combining Apify scraping with AI-powered strategy synthesis, delivering processed insights instead of raw data.

**Deliverable**: Cloudflare Worker project `/projects/facebook-ads-mcp` with functional Apify-powered McpAgent

**Success Criteria**:
- ✅ Single-item inputs (`facebook_page_url: string`, not arrays)
- ✅ Apify integration functional with `apify/facebook-ads-scraper`
- ✅ Cache-before-semaphore implemented (Steps 3.5 → 3.7)
- ✅ Variable pricing works (no ads = 1 token operational fee)
- ✅ ApifySemaphore limits to 32 concurrent runs
- ✅ Semaphore released in finally blocks (ALWAYS)
- ✅ AI Gateway synthesizes ad texts into marketing hooks
- ✅ Extended cache (6 hours) for competitive intelligence
- ✅ Facebook URL validation before Apify calls
- ✅ Tool execution < 45 seconds, AI synthesis < 5 seconds
- ✅ Cache hit response < 500ms

---

## 4. Context

### 4.1. Server Metadata

| Property | Value |
|----------|-------|
| **Human-Readable Name** | Facebook Competitive Intelligence MCP |
| **Class Name** | `FacebookAdsMcp` |
| **Server Slug** | `facebook-ads-mcp` |
| **Domain** | `facebook-ads-mcp.wtyczki.ai` |
| **Repository** | https://github.com/wtyczki-ai/facebook-ads-mcp |
| **Primary Actor** | `apify/facebook-ads-scraper` |

### 4.2. Infrastructure Configuration

**Source**: `/Users/patpil/cloudflare_mcp_projects/cloudflare_mcp_apify/CLOUDFLARE_CONFIG.md`

**KV Namespaces**:
```jsonc
{
  "binding": "CACHE_KV",
  "id": "fa6ff790f146478e85ea77ae4a5caa4b",
  "preview_id": "4b37112559f2429191633d98781645ca"
},
{
  "binding": "OAUTH_KV",
  "id": "b77ec4c7e96043fab0c466a978c2f186",
  "preview_id": "cf8ef9f38ab24ae583d20dd4e973810c"
},
{
  "binding": "USER_SESSIONS",
  "id": "e5ad189139cd44f38ba0224c3d596c73",
  "preview_id": "49c43fb4d6e242db87fd885ba46b5a1d"
},
{
  "binding": "APIFY_CACHE",
  "id": "fa6ff790f146478e85ea77ae4a5caa4b",
  "preview_id": "4b37112559f2429191633d98781645ca"
}
```

**D1 Database**:
```jsonc
{
  "binding": "TOKEN_DB",
  "database_name": "mcp-oauth",
  "database_id": "eac93639-d58e-4777-82e9-f1e28113d5b2"
}
```

**WorkOS Credentials**:
```bash
WORKOS_CLIENT_ID=client_XXXX_YOUR_CLIENT_ID
WORKOS_API_KEY=sk_XXXX_YOUR_API_KEY
```

**AI Gateway**:
```jsonc
"vars": {
  "AI_GATEWAY_ID": "mcp-apify-gateway"
}
```

### 4.3. Apify Prerequisites (MANDATORY)

- Apify Account + API token
- `APIFY_API_TOKEN` secret via `wrangler secret put`
- Actor: `apify/facebook-ads-scraper` (PPR model preferred)
- `APIFY_CACHE` KV namespace binding
- `ApifySemaphore` DO configured in wrangler.jsonc

**Actor Input Template**:
```json
{
  "startUrls": [{ "url": "{{facebook_page_url}}" }],
  "resultsLimit": {{max_ads}},
  "activeStatus": "active",
  "onlyTotal": {{only_total}},
  "isDetailsPerAd": {{details_flag}},
  "proxy": { "useApifyProxy": true }
}
```

### 4.4. AI Gateway (REQUIRED)

**Canonical Pattern**: `/patterns/ai-gateway.md`

**Use Case**: Post-processing/synthesis of raw ad texts into strategic marketing hooks

**Configuration**:
- Gateway ID: `mcp-apify-gateway` (shared across all Apify servers)
- Required Vars: `AI_GATEWAY_ID` in wrangler.jsonc
- Required Secret: `AI_GATEWAY_TOKEN`
- Model: `@cf/meta/llama-3-8b-instruct` (fast, cheap, sufficient for summarization)
- Cache TTL: 3600s (1 hour) for AI analysis responses
- Rate Limiting: 50 req/min
- Error Handling: No token charge on 429/2016/2017 errors

**Setup**:
```bash
echo "your_ai_gateway_token" | wrangler secret put AI_GATEWAY_TOKEN
```

**Integration**: See `/patterns/ai-gateway.md` Pattern 2 (Combined Apify + AI Gateway)

### 4.5. Pricing Models

**Actor**: `apify/facebook-ads-scraper` - PPR (Pay-Per-Result) preferred

**Token Costs**:
- `analyze_competitor_strategy`: 5 tokens (high value - AI synthesis)
- `fetch_creative_gallery`: 3 tokens (medium value - curated gallery)
- `check_activity_pulse`: 1 token (low value - basic check)

**Operational Fee**: 1 token for zero-result scenarios (no ads found)

### 4.6. Security (MANDATORY)

**Package**: `pilpat-mcp-security` v1.1.0+

**Step 4.5 Processing** (applies to ALL Apify responses):
```typescript
// Sanitize output
const sanitized = sanitizeOutput(JSON.stringify(finalResult), {
  removeHtml: true,
  maxLength: 10000,
  removeControlChars: true,
  normalizeWhitespace: true,
});

// Redact PII
const { redacted, detectedPII } = redactPII(sanitized, {
  redactEmails: false,        // Business emails may be public
  redactPhones: false,        // Ad content may include business phones
  redactCreditCards: true,
  redactSSN: true,
  redactBankAccounts: true,
  redactPESEL: true,
  redactPolishIdCard: true,
  redactPolishPassport: true,
  redactPolishPhones: false,  // Business phones may be public
});
```

**Security Policy** - Never expose vendor names:
- ❌ NEVER mention: Apify, SerpData, DataForSEO
- ✅ KEEP: Facebook, Instagram (subjects of analysis)
- ✅ EXEMPTIONS: None for this server

### 4.7. Cache Strategy

**Extended TTL**: 21600s (6 hours) - longer than standard 15 minutes

**Rationale**: Competitive intelligence data changes slowly. High cache hit ratio expected for repeated brand checks within same day.

**Cache Key Logic**: `md5(tool_name + normalized_url + country)`

**Profit Margin Protection**: If User A checks "Nike" and User B checks "Nike" 1 hour later, system pays Apify ONCE, gets paid in tokens TWICE.

### 4.8. Dual Authentication

**Required**: Both OAuth + API Keys

**Implementation Locations**:
- OAuth: `src/server.ts` (McpAgent - 1 location per tool)
- API Keys: `src/api-key-handler.ts` (4 locations per tool):
  1. Register (~line 280)
  2. Tools array (~line 625)
  3. Switch case (~line 750)
  4. Executor function (~line 770)

**Shared**: `USER_SESSIONS` KV from CLOUDFLARE_CONFIG.md

### 4.9. Tool Design Standards

**Canonical Template**: `/templates/tool-description.md` (5-part structure)

**5-Part Formula**:
1. **Purpose**: `[Action Verb] [functionality from Facebook Ad Library]`
2. **Return Value**: `Returns [specific fields]`
3. **Use Case**: `Use this when [scenario]`
4. **Constraints**: `Note: [limitation]` (if applicable)
5. **Cost**: `⚠️ This tool costs X tokens per use` (MANDATORY)

**Input Design**: Single Facebook Page URL (`facebook_page_url: string`), NOT arrays

### 4.10. Documentation References

**Read Once, Cite by Path**:
- `/patterns/apify-7-step.md` - Complete 7-step Apify implementation
- `/patterns/ai-gateway.md` - AI Gateway integration patterns
- `/templates/tool-description.md` - 5-part tool description formula
- `/docs/APIFY_IMPLEMENTATION_GUIDE.md` - Architecture and patterns
- `/development_guide.md` - Implementation details
- `/mcp-server-skeleton-apify/src/server.ts` - OAuth reference
- `/mcp-server-skeleton-apify/src/api-key-handler.ts` - API key reference
- `/mcp-server-skeleton-apify/src/ai-gateway.ts` - AI Gateway integration module
- `/skeleton-api-reference.md` - Function signatures

---

## 5. Machine-Readable Tool Specifications (YAML)

```yaml
tools:
  - id: analyze_competitor_strategy
    displayName: analyzeCompetitorStrategy
    description: "Analyze active Facebook ads for a brand to extract strategic insights. Returns format statistics (video vs image percentages), AI-synthesized marketing hooks, and metadata. Use this when you need to understand a competitor's advertising strategy and messaging patterns. ⚠️ This tool costs 5 tokens per use (includes AI analysis)."
    cost: 5
    costJustification: "Apify Actor execution + AI Gateway synthesis (high-value strategic intelligence)"
    apifyConfig:
      actorId: "apify/facebook-ads-scraper"
      pricingModel: "PPR"
      perResultCost: 5
      maxCost: 5
      timeout: 120
    inputSchema:
      type: object
      properties:
        facebook_page_url:
          type: string
          description: "Facebook Page URL to analyze (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."
          optional: false
        max_ads_to_analyze:
          type: number
          description: "Sample size for analysis (1-30). Default: 10. Higher values provide more comprehensive insights but increase execution time."
          optional: true
        country:
          type: string
          description: "Target country code for ad filtering (ISO 3166-1 alpha-2, e.g., 'US', 'GB'). Default: 'ALL' for global ads. Affects geographic targeting analysis."
          optional: true
      required:
        - facebook_page_url
    businessLogicPlaceholder: |
      // Actor Input Mapping
      const actorInput = {
        startUrls: [{ url: params.facebook_page_url }],
        resultsLimit: params.max_ads_to_analyze || 10,
        activeStatus: "active",
        onlyTotal: false,
        isDetailsPerAd: true,
        proxy: { useApifyProxy: true }
      };

      // Execute Apify Actor
      const results = await apifyClient.runActorSync(ACTOR_ID, actorInput, TIMEOUT);
      const rawAds = results.items || [];

      // Calculate format statistics
      const videoCount = rawAds.filter(ad => ad.snapshot?.cards?.[0]?.video_hd_url).length;
      const imageCount = rawAds.length - videoCount;
      const formatStats = {
        total: rawAds.length,
        video_percentage: rawAds.length > 0 ? Math.round((videoCount / rawAds.length) * 100) : 0,
        image_percentage: rawAds.length > 0 ? Math.round((imageCount / rawAds.length) * 100) : 0
      };

      // Extract ad texts for AI synthesis
      const adTexts = rawAds
        .map(ad => ad.snapshot?.body?.text)
        .filter(text => text && text.length > 0)
        .slice(0, 10);  // Limit to 10 for AI processing

      // AI Gateway: Synthesize marketing hooks
      const aiResponse = await makeAIGatewayRequest(
        { gatewayId: this.env.AI_GATEWAY_ID, token: this.env.AI_GATEWAY_TOKEN },
        "workers-ai",
        "@cf/meta/llama-3-8b-instruct",
        {
          prompt: `Analyze these Facebook ad texts and extract 3 key marketing hooks:\n\n${adTexts.join('\n---\n')}\n\nReturn JSON: {"hooks": ["hook1", "hook2", "hook3"]}`
        },
        3600
      );

      // Combine results
      const finalResult = {
        format_statistics: formatStats,
        marketing_hooks: aiResponse.success ? aiResponse.data : { hooks: [] },
        metadata: {
          page_name: rawAds[0]?.pageName || "Unknown",
          analysis_date: new Date().toISOString(),
          sample_size: rawAds.length
        }
      };

      // Flat Pricing: Charge 5 tokens if data found, 1 token if no ads
      const actualCost = rawAds.length > 0 ? FLAT_COST : 1;
    securityConfig:
      maxLength: 10000
      removeHtml: true
      removeControlChars: true
      normalizeWhitespace: true
      redactEmails: false
      redactPhones: false
      redactCreditCards: true
      redactSSN: true
      redactBankAccounts: true
      redactPESEL: true
      redactPolishIdCard: true
      redactPolishPassport: true
      redactPolishPhones: false
    cacheConfig:
      enabled: true
      ttl: 21600
      cacheBeforeSemaphore: true
    aiGatewayConfig:
      enabled: true
      provider: "workers-ai"
      model: "@cf/meta/llama-3-8b-instruct"
      cacheTtl: 3600
      errorHandling:
        retryOnRateLimit: false
        retryOnContentBlock: false

  - id: fetch_creative_gallery
    displayName: fetchCreativeGallery
    description: "Fetch direct URLs to ad images and video thumbnails for visual inspiration. Returns curated list of creative assets with metadata. Use this when you need visual examples of a competitor's ad creatives. ⚠️ This tool costs 3 tokens per use."
    cost: 3
    costJustification: "Apify Actor execution with creative asset extraction"
    apifyConfig:
      actorId: "apify/facebook-ads-scraper"
      pricingModel: "PPR"
      perResultCost: 3
      maxCost: 3
      timeout: 120
    inputSchema:
      type: object
      properties:
        facebook_page_url:
          type: string
          description: "Facebook Page URL to fetch creatives from (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."
          optional: false
        limit:
          type: number
          description: "Number of creative assets to return (1-30). Default: 10. Controls gallery size and response context."
          optional: true
      required:
        - facebook_page_url
    businessLogicPlaceholder: |
      // Actor Input Mapping
      const actorInput = {
        startUrls: [{ url: params.facebook_page_url }],
        resultsLimit: params.limit || 10,
        activeStatus: "active",
        onlyTotal: false,
        isDetailsPerAd: true,
        proxy: { useApifyProxy: true }
      };

      // Execute Apify Actor
      const results = await apifyClient.runActorSync(ACTOR_ID, actorInput, TIMEOUT);
      const rawAds = results.items || [];

      // Extract creative assets
      const creatives = rawAds.map(ad => {
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
      }).filter(creative => creative.url);

      const finalResult = {
        creatives: creatives,
        metadata: {
          total_count: creatives.length,
          page_name: rawAds[0]?.pageName || "Unknown",
          fetch_date: new Date().toISOString()
        }
      };

      // Flat Pricing: Charge 3 tokens if creatives found, 1 token if no ads
      const actualCost = creatives.length > 0 ? FLAT_COST : 1;
    securityConfig:
      maxLength: 10000
      removeHtml: true
      removeControlChars: true
      normalizeWhitespace: true
      redactEmails: false
      redactPhones: false
      redactCreditCards: true
      redactSSN: true
      redactBankAccounts: true
      redactPESEL: true
      redactPolishIdCard: true
      redactPolishPassport: true
      redactPolishPhones: false
    cacheConfig:
      enabled: true
      ttl: 21600
      cacheBeforeSemaphore: true
    aiGatewayConfig:
      enabled: false

  - id: check_activity_pulse
    displayName: checkActivityPulse
    description: "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use."
    cost: 1
    costJustification: "Lightweight Apify Actor execution (onlyTotal mode)"
    apifyConfig:
      actorId: "apify/facebook-ads-scraper"
      pricingModel: "PPR"
      perResultCost: 1
      maxCost: 1
      timeout: 60
    inputSchema:
      type: object
      properties:
        facebook_page_url:
          type: string
          description: "Facebook Page URL to check activity for (e.g., 'https://www.facebook.com/Nike'). Must be a valid Facebook Page URL. Required."
          optional: false
      required:
        - facebook_page_url
    businessLogicPlaceholder: |
      // Actor Input Mapping (lightweight mode)
      const actorInput = {
        startUrls: [{ url: params.facebook_page_url }],
        resultsLimit: 1,
        activeStatus: "active",
        onlyTotal: true,
        isDetailsPerAd: false,
        proxy: { useApifyProxy: true }
      };

      // Execute Apify Actor
      const results = await apifyClient.runActorSync(ACTOR_ID, actorInput, TIMEOUT);
      const totalCount = results.items?.[0]?.totalCount || 0;
      const pageName = results.items?.[0]?.pageName || "Unknown";

      const finalResult = {
        is_active: totalCount > 0,
        total_ads: totalCount,
        page_name: pageName,
        last_updated: new Date().toISOString()
      };

      // Flat Pricing: Always 1 token (lightweight check)
      const actualCost = FLAT_COST;
    securityConfig:
      maxLength: 1000
      removeHtml: true
      removeControlChars: true
      normalizeWhitespace: true
      redactEmails: false
      redactPhones: false
      redactCreditCards: true
      redactSSN: true
      redactBankAccounts: true
      redactPESEL: true
      redactPolishIdCard: true
      redactPolishPassport: true
      redactPolishPhones: false
    cacheConfig:
      enabled: true
      ttl: 21600
      cacheBeforeSemaphore: true
    aiGatewayConfig:
      enabled: false
```

---

## 6. Implementation Blueprint

### Repository Context

**Multi-repository architecture**:
- Main: `/Users/patpil/cloudflare_mcp_projects/cloudflare_mcp_apify`
- Server: `/Users/patpil/cloudflare_mcp_projects/cloudflare_mcp_apify/projects/facebook-ads-mcp`

**Commit Strategy**:
- Server changes → Server repository (https://github.com/wtyczki-ai/facebook-ads-mcp)
- Shared files (development_guide.md) → Main repository

**Post-Commit**: Update `repos_mcp.md` in main repo with server mapping

---

### Task A0: Apify Setup & Actor Selection

**Prerequisites**:
- Apify account created
- API token generated (Settings → Integrations → API Tokens)

**Actions**:
1. Set secret: `echo "apify_api_XXX" | wrangler secret put APIFY_API_TOKEN`
2. Verify: `wrangler secret list` (shows APIFY_API_TOKEN)
3. Document Actor in `docs/ACTOR_CONFIGURATION.md`:
   ```markdown
   ## Actor: apify/facebook-ads-scraper
   - Pricing: PPR (Pay-Per-Result)
   - Token Costs: 5 (strategy), 3 (gallery), 1 (pulse)
   - Timeout: 120s (strategy/gallery), 60s (pulse)
   - Input Template: See Section 5 YAML specs
   ```

**Validation**: `wrangler secret list | grep APIFY_API_TOKEN`

---

### Task B0: Infrastructure Setup

**Actions**:
1. Verify KV bindings in `wrangler.jsonc`:
   ```jsonc
   "kv_namespaces": [
     {
       "binding": "APIFY_CACHE",
       "id": "fa6ff790f146478e85ea77ae4a5caa4b",
       "preview_id": "4b37112559f2429191633d98781645ca"
     },
     {
       "binding": "CACHE_KV",
       "id": "fa6ff790f146478e85ea77ae4a5caa4b",
       "preview_id": "4b37112559f2429191633d98781645ca"
     },
     {
       "binding": "OAUTH_KV",
       "id": "b77ec4c7e96043fab0c466a978c2f186",
       "preview_id": "cf8ef9f38ab24ae583d20dd4e973810c"
     },
     {
       "binding": "USER_SESSIONS",
       "id": "e5ad189139cd44f38ba0224c3d596c73",
       "preview_id": "49c43fb4d6e242db87fd885ba46b5a1d"
     }
   ]
   ```

2. Verify ApifySemaphore DO in `wrangler.jsonc`:
   ```jsonc
   "durable_objects": {
     "bindings": [
       {
         "class_name": "ApifySemaphore",
         "name": "APIFY_SEMAPHORE"
       }
     ]
   },
   "migrations": [
     {
       "new_sqlite_classes": ["ApifySemaphore"],
       "tag": "v1"
     }
   ]
   ```

3. Verify D1 database in `wrangler.jsonc`:
   ```jsonc
   "d1_databases": [
     {
       "binding": "TOKEN_DB",
       "database_name": "mcp-oauth",
       "database_id": "eac93639-d58e-4777-82e9-f1e28113d5b2"
     }
   ]
   ```

4. Verify AI Gateway configuration:
   ```jsonc
   "vars": {
     "AI_GATEWAY_ID": "mcp-apify-gateway"
   }
   ```

5. Verify types in `src/types.ts`:
   ```typescript
   export interface Env {
     APIFY_CACHE: KVNamespace;
     APIFY_SEMAPHORE: DurableObjectNamespace;
     APIFY_API_TOKEN: string;
     AI_GATEWAY_ID: string;
     AI_GATEWAY_TOKEN: string;
     CACHE_KV: KVNamespace;
     OAUTH_KV: KVNamespace;
     USER_SESSIONS: KVNamespace;
     TOKEN_DB: D1Database;
     WORKOS_CLIENT_ID: string;
     WORKOS_API_KEY: string;
     AI: Ai;
   }
   ```

**Validation**: `npx tsc --noEmit && bash ../../scripts/verify-consistency.sh`

---

### Task B1: Scaffold from Apify Skeleton

**Action**: `./scripts/create-new-server.sh facebook-ads-mcp`

**Skeleton Includes**:
- ApifySemaphore binding
- APIFY_CACHE KV namespace
- AI Gateway integration module (`src/ai-gateway.ts`)
- Reference tools with OAuth + API key paths
- Single-item design patterns
- Security integration (Step 4.5)

**Post-Creation**:
1. Update `wrangler.jsonc` with exact IDs from `CLOUDFLARE_CONFIG.md`
2. Update `package.json`:
   ```json
   {
     "name": "facebook-ads-mcp",
     "description": "Facebook Competitive Intelligence MCP Server"
   }
   ```
3. Run: `npm install`

**Validation**:
```bash
npx tsc --noEmit
./scripts/verify-consistency.sh
```

---

### Task B2: Configure WorkOS Secrets

**Actions**:
```bash
echo "xxx" | wrangler secret put WORKOS_CLIENT_ID
echo "xxx" | wrangler secret put WORKOS_API_KEY
wrangler secret list  # Verify both set
```

**Validation**: `wrangler secret list | grep WORKOS`

---

### Task B2.5: Configure AI Gateway (REQUIRED)

**Why Required**: `analyze_competitor_strategy` tool needs AI synthesis of marketing hooks

**Actions**:
```bash
echo "AI_GATEWAY_TOKEN" | wrangler secret put AI_GATEWAY_TOKEN
wrangler secret list  # Verify set
```

**Get Token**: Cloudflare Dashboard > AI > AI Gateway > mcp-apify-gateway > Settings

**Bulk Setup** (for multiple servers):
```bash
bash ../../scripts/setup-ai-gateway-token.sh
```

**Validation**: `wrangler secret list | grep AI_GATEWAY_TOKEN`

---

### Task B3: Initialize ApifyClient

**Action**: Verify `src/apify-client.ts` exists (from skeleton)

**Implementation** (already in skeleton):
```typescript
export class ApifyClient {
  async runActorSync<T>(
    actorId: string,
    input: Record<string, any>,
    timeout: number = 60
  ): Promise<{ items: T[] }> {
    // Fetch API implementation
  }
}
```

**Validation**: `npx tsc --noEmit`

---

### Task B4: Dual Authentication Parity

**Actions**:
1. Count tools in OAuth path: `grep -c "this.server.tool(" src/server.ts`
2. Count tools in API key path: `grep -c "server.tool(" src/api-key-handler.ts`
3. Verify counts match (should be 3 for both)

**Fix if Mismatch**:
- Add missing tools to API key path (4 locations per tool):
  1. Register (~line 280)
  2. Tools array (~line 625)
  3. Switch case (~line 750)
  4. Executor function (~line 770)

**Validation**: `bash ../../scripts/verify-dual-auth-parity.sh`

---

### Task B5: Implement Facebook Ads Tools

**Canonical Pattern**: `/patterns/apify-7-step.md` (Complete implementation)
**AI Gateway Pattern**: `/patterns/ai-gateway.md` (For `analyze_competitor_strategy`)

**Method**:
1. Generate code:
   ```bash
   npm run generate-tool --prp ../../PRPs/facebook-ads-mcp.md --all --output snippets
   ```

2. Copy generated code to 5 locations per tool:
   - OAuth: `src/server.ts` (1 location)
   - API Key: `src/api-key-handler.ts` (4 locations: register, tools array, switch, executor)

3. Replace `// TODO: Implement API integration` with:
   - **Tool 1 (analyze_competitor_strategy)**: Apify scraping + format stats calculation + AI Gateway synthesis
   - **Tool 2 (fetch_creative_gallery)**: Apify scraping + creative asset extraction
   - **Tool 3 (check_activity_pulse)**: Lightweight Apify check (onlyTotal mode)

**Critical Pattern Elements** (see `/patterns/apify-7-step.md`):
- Step 3.5: Cache check FIRST (before semaphore) - **TTL: 21600s (6 hours)**
- Step 3.7: Semaphore acquire (only on cache miss)
- Step 4: Execute Apify Actor with proper input mapping
- Step 4.3: Extract results (handle zero-result case)
- Step 4.5: Security processing (sanitizeOutput + redactPII)
- Step 4.7: Cache result (21600s TTL - extended for competitive intelligence)
- Finally block: Release semaphore (ALWAYS)

**Tool 1 Specific** (analyze_competitor_strategy):
- After Apify scraping, calculate format statistics (video vs image)
- Extract ad texts and call AI Gateway for hook synthesis
- See `/patterns/ai-gateway.md` Pattern 2 (Combined Apify + AI)
- Handle AI Gateway errors (don't fail entire request)

**Facebook URL Validation**:
```typescript
// Add before Apify call in all tools
const facebookUrlPattern = /^https:\/\/(www\.)?facebook\.com\/.+$/;
if (!facebookUrlPattern.test(params.facebook_page_url)) {
  throw new Error("Invalid Facebook Page URL. Must start with https://facebook.com/");
}
```

**Validation**:
```bash
npx tsc --noEmit
bash ../../scripts/verify-dual-auth-parity.sh
bash ../../scripts/verify-security-integration.sh
```

---

### Task C0: Pre-Deployment Validation

**Run Bundled**:
```bash
bash ../../scripts/run-all-validations.sh
```

**Or Individual**:
```bash
npx tsc --noEmit
./scripts/verify-consistency.sh
bash ../../scripts/verify-dual-auth-parity.sh
bash ../../scripts/verify-security-integration.sh
bash ../../scripts/validate-runtime-secrets.sh
```

**Fix All Errors Before Proceeding**

**Checkpoint**: Save after validation passes

---

### Task C1: Initial Deployment

**Actions**:
1. Initialize Git repository (if not exists):
   ```bash
   git init
   git remote add origin https://github.com/wtyczki-ai/facebook-ads-mcp.git
   ```

2. Stage: `git add .`

3. Commit:
   ```bash
   git commit -m "feat: Implement Facebook Competitive Intelligence MCP with AI synthesis

   - Add analyze_competitor_strategy (5 tokens): Format stats + AI marketing hooks
   - Add fetch_creative_gallery (3 tokens): Visual asset extraction
   - Add check_activity_pulse (1 token): Lightweight activity check
   - Extended cache: 21600s (6 hours) for competitive intelligence
   - AI Gateway integration: @cf/meta/llama-3-8b-instruct
   - Facebook URL validation before Apify calls
   - Dual authentication: OAuth + API Keys (3 tools × 5 locations)

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

4. Push: `git push -u origin main`

5. Update `repos_mcp.md` in main repo:
   ```bash
   cd ../..
   # Add to repos_mcp.md:
   # projects/facebook-ads-mcp → https://github.com/wtyczki-ai/facebook-ads-mcp
   git add repos_mcp.md
   git commit -m "docs: Add facebook-ads-mcp to repository mapping"
   git push
   ```

**Deployment**: Automatic via Cloudflare Workers Builds

**Validation**: Check deployment at `https://facebook-ads-mcp.wtyczki.ai`

---

### Task C2: Functional Testing

**Test in Cloudflare Dashboard**:

1. **Tool 1: analyze_competitor_strategy**
   ```json
   {
     "facebook_page_url": "https://www.facebook.com/Nike",
     "max_ads_to_analyze": 5
   }
   ```
   Expected: Format stats + 3 marketing hooks (< 45 seconds)

2. **Tool 2: fetch_creative_gallery**
   ```json
   {
     "facebook_page_url": "https://www.facebook.com/Nike",
     "limit": 5
   }
   ```
   Expected: Array of creative assets with URLs

3. **Tool 3: check_activity_pulse**
   ```json
   {
     "facebook_page_url": "https://www.facebook.com/Nike"
   }
   ```
   Expected: `{ is_active: true, total_ads: >0 }` (< 10 seconds)

4. **Cache Hit Test**:
   - Run Tool 3 twice with same URL
   - Second run should be < 500ms (cache hit)

5. **Zero-Result Test**:
   ```json
   {
     "facebook_page_url": "https://www.facebook.com/some-inactive-page"
   }
   ```
   Expected: 1 token charge (operational fee)

6. **Facebook URL Validation**:
   ```json
   {
     "facebook_page_url": "https://twitter.com/Nike"
   }
   ```
   Expected: Error "Invalid Facebook Page URL"

---

## 7. Success Validation

### Validation Checklist

**Apify Infrastructure**:
- [ ] ApifySemaphore DO configured (32 slots)
- [ ] APIFY_CACHE KV bound
- [ ] APIFY_API_TOKEN secret set
- [ ] ApifyClient initialized
- [ ] Actor `apify/facebook-ads-scraper` accessible

**AI Gateway**:
- [ ] AI_GATEWAY_ID configured in wrangler.jsonc
- [ ] AI_GATEWAY_TOKEN secret set
- [ ] AI Gateway types added to Env interface
- [ ] `makeAIGatewayRequest()` function available
- [ ] AI error handling implemented (no charge on 429/2016/2017)

**Implementation Quality**:
- [ ] Cache checked BEFORE semaphore (Step 3.5 → 3.7)
- [ ] Cache TTL: 21600s (6 hours) - extended for competitive intelligence
- [ ] Semaphore released in finally block (all 3 tools)
- [ ] Facebook URL validation before Apify calls
- [ ] AI synthesis in `analyze_competitor_strategy`
- [ ] Format statistics calculated correctly
- [ ] Creative asset extraction in `fetch_creative_gallery`
- [ ] Operational fee (1 token) for zero-result scenarios
- [ ] Security applied (Step 4.5) to all tools
- [ ] Tool descriptions follow 5-part structure with ⚠️
- [ ] No vendor names exposed (Apify not mentioned)

**TypeScript & Build**:
- [ ] `npx tsc --noEmit` passes
- [ ] No type errors in all 5 locations per tool

**Deployment**:
- [ ] Git pushed to https://github.com/wtyczki-ai/facebook-ads-mcp
- [ ] Domain accessible: https://facebook-ads-mcp.wtyczki.ai
- [ ] Cloudflare Workers Builds triggered
- [ ] `repos_mcp.md` updated in main repo

**Dual Auth**:
- [ ] Tool count matches: 3 OAuth, 3 API Key (5 locations each)
- [ ] Descriptions identical across 5 locations
- [ ] Both paths implement cache-before-semaphore
- [ ] Both paths apply security (Step 4.5)
- [ ] Both paths validate Facebook URLs

**Performance**:
- [ ] Tool execution < 45 seconds (strategy/gallery)
- [ ] AI synthesis < 5 seconds
- [ ] Cache hit response < 500ms
- [ ] Pulse check < 10 seconds

---

## 8. Troubleshooting

### Common Issues

**Semaphore Always Full (32/32)**:
- **Cause**: Missing finally block or semaphore not released
- **Fix**: Add `finally { if (slot) await semaphore.releaseSlot(userId); }` to all 3 tools

**Cache Not Working**:
- **Cause**: KV namespace not bound or wrong TTL
- **Fix**: Verify binding in `wrangler.jsonc`, ensure TTL is 21600s (not default 900s)

**AI Gateway Errors**:
- **Cause**: Missing AI_GATEWAY_TOKEN or invalid gateway ID
- **Fix**: Verify secret with `wrangler secret list`, check AI_GATEWAY_ID is "mcp-apify-gateway"

**Incorrect Token Charges**:
- **Cause**: Not using operational fee for zero-result cases
- **Fix**:
  ```typescript
  // Tool 1 & 2: Charge 5/3 if results, 1 if no ads
  const actualCost = (results.length > 0) ? FLAT_COST : 1;

  // Tool 3: Always charge 1 (lightweight check)
  const actualCost = FLAT_COST;  // FLAT_COST = 1
  ```

**Facebook URL Validation Failing**:
- **Cause**: Incorrect regex pattern
- **Fix**: Use `/^https:\/\/(www\.)?facebook\.com\/.+$/`

**AI Synthesis Not Working**:
- **Cause**: AI Gateway not configured or prompt formatting issues
- **Fix**: Check `/patterns/ai-gateway.md` Pattern 2, ensure ad texts properly formatted

**TypeScript Errors**:
- **Cause**: Missing AI Gateway types or incorrect Env interface
- **Fix**: Add `AI_GATEWAY_ID: string; AI_GATEWAY_TOKEN: string;` to Env interface

---

**Version**: 4.0.0 (MRC Optimized - Pattern References)
**Generated**: 2025-11-20
**Actor**: apify/facebook-ads-scraper
**AI Gateway**: mcp-apify-gateway (Required)
**Repository**: https://github.com/wtyczki-ai/facebook-ads-mcp
