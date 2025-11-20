# Facebook Ads MCP - Infrastructure Snapshot

**Generated**: 2025-11-20
**Repository**: facebook-ads-mcp
**Status**: Production

---

## 1. Project Identity Metrics

- **Human-Readable Name**: Facebook Ads MCP Server
- **Server Slug**: facebook-ads-mcp
- **Wrangler Name**: facebook-ads-mcp
- **Description**: Facebook Competitive Intelligence MCP Server - Scrapes Facebook Ad Library data via Apify and synthesizes it into strategic insights using AI

---

## 2. AI Infrastructure (Intelligence Stack)

### Workers AI

- **Workers AI Status**: ✅ **Enabled and Actively Used**
- **Binding**: AI
- **Model ID**: @cf/meta/llama-3-8b-instruct (Meta Llama 3 8B Instruct)
- **AI Usage**: Marketing hook synthesis from competitor ad texts
- **Integration Point**: analyzeCompetitorStrategy tool (Step 4 - AI synthesis)

### AI Gateway

- **AI Gateway Status**: ✅ **Enabled and Actively Used**
- **Gateway ID**: mcp-apify-gateway (shared across all Apify-based MCP servers)
- **AI Cache Policy**: 1-hour TTL (3600 seconds) for AI responses
- **Rate Limiting**: 50 requests/minute (fixed window)
- **Request Logging**: 10M log limit
- **Configuration**: Token stored as `AI_GATEWAY_TOKEN` secret

**Active Integration**:
```typescript
await makeAIGatewayRequest(
  { gatewayId: env.AI_GATEWAY_ID, token: env.AI_GATEWAY_TOKEN },
  "workers-ai",
  "@cf/meta/llama-3-8b-instruct",
  { prompt: "Analyze these Facebook ad texts..." },
  3600
);
```

**AI Workflow** (analyzeCompetitorStrategy tool):
1. Scrape Facebook ads via Apify Actor
2. Extract ad text bodies (up to 10 ads)
3. Send to AI Gateway → Workers AI (Llama 3)
4. Parse JSON response with marketing hooks
5. Combine with format statistics
6. Return synthesized insights

---

## 3. Detailed Tool Audit (Tool Inventory)

### Tool Registry

**Total Tools**: 3 (tiered pricing: 1, 3, 5 tokens)

#### Tool 1: analyzeCompetitorStrategy

**Technical Name**: `analyzeCompetitorStrategy`

**Description (Verbatim)**:
> "Analyze competitor Facebook ad creative strategy to identify format preferences and effective marketing hooks. Returns format statistics (video vs image percentage) and AI-synthesized marketing angles. Use this when you need to understand how a competitor structures their ad campaigns and what messaging resonates. ⚠️ This tool costs 5 tokens per use."

**Token Cost**: 5 tokens per use (flat pricing)

**Input Schema**:
- `facebook_page_url` (string, required): Facebook Page URL to analyze
- `max_ads_to_analyze` (number, optional): Number of active ads to analyze (1-50, default: 10)

**Output Structure**:
```json
{
  "format_statistics": {
    "total": 10,
    "video_percentage": 60,
    "image_percentage": 40
  },
  "marketing_hooks": {
    "hooks": ["hook1", "hook2", "hook3"]
  },
  "metadata": {
    "page_name": "Nike",
    "analysis_date": "2025-11-20T...",
    "sample_size": 10
  }
}
```

**Dual Auth Parity**: ✅ Confirmed
- OAuth Path: src/server.ts:52-269
- API Key Path (Registration): src/api-key-handler.ts:314-325
- API Key Path (Executor): src/api-key-handler.ts:658-841

**Implementation Details**:
- Apify Actor: `apify/facebook-ads-scraper`
- AI Model: @cf/meta/llama-3-8b-instruct (Llama 3 8B)
- Timeout: 120 seconds (2 minutes)
- Cache TTL: 21600 seconds (6 hours - longest in fleet)
- AI Cache: 3600 seconds (1 hour)
- Pricing Model: Flat cost (5 tokens always, 1 token if no ads)
- Semaphore: ApifySemaphore (32-slot concurrency control)
- Cache-Before-Semaphore: ✅ Implemented (Step 3.5 before Step 3.7)

**Unique Feature - AI Synthesis**:
- Extracts up to 10 ad texts
- Sends to AI Gateway for analysis
- Returns 3 key marketing hooks
- JSON parsing with fallback to empty array

#### Tool 2: fetchCreativeGallery

**Technical Name**: `fetchCreativeGallery`

**Description (Verbatim)**:
> "Fetch direct URLs to ad images and video thumbnails for visual inspiration. Returns curated list of creative assets with metadata. Use this when you need visual examples of a competitor's ad creatives. ⚠️ This tool costs 3 tokens per use."

**Token Cost**: 3 tokens per use (flat pricing)

**Input Schema**:
- `facebook_page_url` (string, required): Facebook Page URL to fetch creatives from
- `limit` (number, optional): Number of creative assets to return (1-30, default: 10)

**Output Structure**:
```json
{
  "creatives": [
    {
      "type": "video" | "image",
      "url": "https://...",
      "thumbnail_url": "https://...",
      "headline": "Ad headline",
      "body_text": "Ad body text",
      "cta": "Shop Now"
    }
  ],
  "metadata": {
    "total_count": 10,
    "page_name": "Nike",
    "fetch_date": "2025-11-20T..."
  }
}
```

**Dual Auth Parity**: ✅ Confirmed
- OAuth Path: src/server.ts:274-467
- API Key Path (Registration): src/api-key-handler.ts:328-339
- API Key Path (Executor): src/api-key-handler.ts:842-1001

**Implementation Details**:
- Apify Actor: `apify/facebook-ads-scraper`
- Timeout: 120 seconds (2 minutes)
- Cache TTL: 21600 seconds (6 hours)
- Pricing Model: Flat cost (3 tokens always, 1 token if no creatives)
- Extraction Logic: Maps video_hd_url or originalImageUrl

#### Tool 3: checkActivityPulse

**Technical Name**: `checkActivityPulse`

**Description (Verbatim)**:
> "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use."

**Token Cost**: 1 token per use (flat pricing)

**Input Schema**:
- `facebook_page_url` (string, required): Facebook Page URL to check activity for

**Output Structure**:
```json
{
  "is_active": true,
  "total_ads": 42,
  "page_name": "Nike",
  "last_updated": "2025-11-20T..."
}
```

**Dual Auth Parity**: ✅ Confirmed
- OAuth Path: src/server.ts:472-648
- API Key Path (Registration): src/api-key-handler.ts:342-352
- API Key Path (Executor): src/api-key-handler.ts:1002-1141

**Implementation Details**:
- Apify Actor: `apify/facebook-ads-scraper`
- Actor Mode: `onlyTotal: true` (metadata only, no full ad data)
- Timeout: 60 seconds (1 minute)
- Cache TTL: 21600 seconds (6 hours)
- Pricing Model: Flat cost (1 token always)
- Max Output: 1,000 characters (smallest sanitization limit)

**MCP Prompt Descriptions**: Not implemented (no custom prompts defined)

---

## 4. Security and Compliance

### Vendor Hiding

✅ **Compliant**: No vendor names detected in tool descriptions
- "Apify": Not mentioned in any tool description
- Tool descriptions only reference Facebook (subject of analysis, permitted)

### PII Redaction

✅ **Active**: pilpat-mcp-security v1.1.0

**Configuration**:
```typescript
redactEmails: false       // Ad texts may contain contact info (public ads)
redactPhones: false       // Phone numbers in ads are public
redactCreditCards: true
redactSSN: true
redactBankAccounts: true
redactPESEL: true         // Polish national ID
redactPolishIdCard: true
redactPolishPassport: true
redactPolishPhones: false // Business phones in ads are public
```

**Rationale**: Email and phone redaction disabled because Facebook ads contain publicly disclosed marketing content. Any contact information in ads is intentionally public.

**Security Processing**: Implemented at Step 4.5 in all three tools (both OAuth and API key paths)
- `sanitizeOutput()`: HTML removal, control character stripping, whitespace normalization
- `redactPII()`: Pattern-based PII detection with Polish market support
- Security logging: Console warnings when PII patterns detected

**Output Sanitization Limits**:
- analyzeCompetitorStrategy: 10,000 characters
- fetchCreativeGallery: 10,000 characters
- checkActivityPulse: 1,000 characters

---

## 5. Deployment Status

### Consistency Tests

**Script**: `../../scripts/verify-consistency.sh`
**Result**: ✅ All consistency checks passed

**Verified Components**:
- Durable Objects configuration (FacebookAdsMCP, ApifySemaphore)
- KV namespace bindings (OAUTH_KV, CACHE_KV, USER_SESSIONS, APIFY_CACHE)
- D1 database binding (TOKEN_DB)
- Workers AI binding (AI)
- AI Gateway configuration (AI_GATEWAY_ID)
- Custom domain configuration

### Production URL

**Primary Domain**: https://facebook-ads-mcp.wtyczki.ai
**Workers.dev**: Disabled (security best practice)

**Custom Domain Configuration**:
- Pattern: facebook-ads-mcp.wtyczki.ai
- Custom Domain: Enabled
- Automatic DNS: Yes
- Automatic TLS: Yes

---

## 6. Infrastructure Components

### Durable Objects

1. **FacebookAdsMCP**: MCP protocol handling, WebSocket management, session state
2. **ApifySemaphore**: 32-slot concurrency control for Apify API limits

### KV Namespaces (Shared + Dedicated)

1. **OAUTH_KV** (b77ec4c7e96043fab0c466a978c2f186): OAuth token storage (shared)
2. **CACHE_KV** (fa6ff790f146478e85ea77ae4a5caa4b): General API response caching (shared)
3. **USER_SESSIONS** (e5ad189139cd44f38ba0224c3d596c73): Custom login sessions (shared)
4. **APIFY_CACHE** (fa6ff790f146478e85ea77ae4a5caa4b): Dedicated Apify result cache (6-hour TTL)

**Note**: APIFY_CACHE uses same ID as CACHE_KV (dual binding for semantic clarity)

### D1 Database (Shared)

**Binding**: TOKEN_DB
**Database ID**: ebb389aa-2d65-4d38-a0da-50c7da9dfe8b
**Database Name**: mcp-tokens-database

### Workers AI

**Binding**: AI
**Status**: ✅ Actively Used
**Model**: @cf/meta/llama-3-8b-instruct
**Use Case**: Marketing hook synthesis from competitor ad texts
**Integration**: AI Gateway proxy (rate limiting, caching, logging)

### Secrets (Wrangler)

1. **WORKOS_CLIENT_ID**: WorkOS OAuth client ID
2. **WORKOS_API_KEY**: WorkOS authentication API key
3. **APIFY_API_TOKEN**: Apify API token for Actor execution
4. **AI_GATEWAY_TOKEN**: ✅ **Required** - AI Gateway authentication (actively used)

---

## 7. Architecture Patterns

### Authentication

**Dual Transport**: OAuth + API Keys
- OAuth Path: `/sse` endpoint (WorkOS Magic Auth)
- API Key Path: `/mcp` endpoint (Bearer token)

### Caching Strategy

**Dual-Layer Cache Architecture**:

**Layer 1: KV Cache (APIFY_CACHE)**
- TTL: 6 hours (21,600 seconds - longest in fleet)
- Scope: Apify Actor results (raw ad data)
- Pattern: Cache-Before-Semaphore (Step 3.5)

**Layer 2: AI Gateway Cache**
- TTL: 1 hour (3,600 seconds)
- Scope: AI-synthesized marketing hooks
- Provider: Cloudflare AI Gateway
- Model: @cf/meta/llama-3-8b-instruct

**Cache-Before-Semaphore Flow**:
1. Step 3.5: Check KV cache (APIFY_CACHE)
2. Cache HIT → Return immediately (full token cost charged)
3. Cache MISS → Proceed to Step 3.7
4. Step 3.7: Acquire ApifySemaphore slot
5. Execute Apify Actor
6. If AI required: Call AI Gateway (1-hour AI cache)
7. Cache result (6-hour TTL)

**Benefits**:
- Prevents semaphore slot waste on cached data
- Reduces Apify API costs
- AI Gateway caching reduces Workers AI costs
- 6-hour TTL optimizes for ad campaign longevity

**100% Paid Cache Model** (all tools):
- Cache hits charge **full token cost** (1, 3, or 5 tokens)
- Rationale: 6-hour TTL guarantees recent competitive intelligence
- Users pay for data quality, not infrastructure

### Pricing Model

**Tiered Flat Pricing** (3 tiers):
- **checkActivityPulse**: 1 token (reconnaissance)
- **fetchCreativeGallery**: 3 tokens (visual assets)
- **analyzeCompetitorStrategy**: 5 tokens (AI-powered analysis)

**Exceptional Pricing** (zero-result fallback):
- analyzeCompetitorStrategy: 1 token if no ads found
- fetchCreativeGallery: 1 token if no creatives found
- checkActivityPulse: 1 token always (guaranteed metadata)

**AI Cost Bundling**:
- Workers AI inference included in 5-token cost
- No separate charge for AI Gateway requests
- AI synthesis considered value-add (not cost pass-through)

### Concurrency Control

**ApifySemaphore**: Global Durable Object
- Max slots: 32 concurrent Actor runs
- Slot acquisition: Step 3.7 (after cache check)
- Slot release: `finally` block (guaranteed cleanup)
- Fast Fail: Returns error if no slots available (no blocking queue)

---

## 8. Code Quality

### Type Safety

**TypeScript**: ✅ Strict mode enabled
**Zod Schemas**: ✅ Input validation with descriptive parameter schemas
**URL Validation**: Regex pattern for Facebook URLs (`/^https:\/\/(www\.)?facebook\.com\/.+$/`)

### Error Handling

- Account deleted: Checked in Step 2 (via `checkBalance`)
- Insufficient tokens: Checked in Step 2 (balance verification)
- Semaphore timeout: Fast fail with estimated wait time
- Actor failures: Graceful error messages
- AI parsing failures: JSON.parse with try/catch fallback
- Zero results: Conditional token charging (1 token minimum)
- Invalid URL: Regex validation before Actor execution

### Observability

**Cloudflare Observability**: Enabled (wrangler.jsonc:176)

**Console Logging**:
- Cache HIT/MISS events (KV cache)
- Semaphore acquisition/release
- Token consumption (tiered pricing)
- AI Gateway requests and responses
- PII detection warnings
- Error traces

---

## 9. Technical Specifications

### Performance

**Timeouts**:
- analyzeCompetitorStrategy: 120 seconds (2 minutes)
- fetchCreativeGallery: 120 seconds (2 minutes)
- checkActivityPulse: 60 seconds (1 minute)

**Cache TTL**:
- KV Cache (Apify results): 21,600 seconds (6 hours)
- AI Gateway Cache: 3,600 seconds (1 hour)

**AI Gateway Limits**:
- Rate Limiting: 50 requests/minute (fixed window)
- Request Logging: 10M log limit
- Cache Policy: 1-day TTL for responses

### Dependencies

**Production**:
- @modelcontextprotocol/sdk: ^1.18.2
- @cloudflare/workers-oauth-provider: ^0.0.11
- @workos-inc/node: ^7.70.0
- agents: ^0.2.4 (McpAgent framework)
- hono: ^4.10.3 (HTTP routing)
- jose: ^6.1.0 (JWT handling)
- pilpat-mcp-security: ^1.1.0 (PII redaction)
- zod: ^3.25.76 (schema validation)

**Development**:
- @cloudflare/workers-types: ^4.20250101.0
- typescript: ^5.9.2
- wrangler: ^4.40.1

---

## 10. Compliance Summary

| Check | Status | Notes |
|---|---|---|
| Vendor Hiding | ✅ | No "Apify" in descriptions |
| PII Redaction | ✅ | pilpat-mcp-security v1.1.0 with Polish patterns |
| Dual Auth Parity | ✅ | OAuth + API Key paths identical |
| Cache-Before-Semaphore | ✅ | Step 3.5 before Step 3.7 |
| Semaphore Release | ✅ | In `finally` block |
| Tiered Pricing | ✅ | 1, 3, 5 tokens (flat per tool) |
| Security Processing | ✅ | Step 4.5 implemented in all tools |
| Custom Domain | ✅ | facebook-ads-mcp.wtyczki.ai |
| Workers.dev Disabled | ✅ | Security best practice |
| Consistency Tests | ✅ | All checks passed |
| AI Gateway | ✅ | Actively used with 1-hour cache |
| Workers AI | ✅ | Llama 3 8B for marketing analysis |

---

## 11. Unique Architectural Features

### First AI-Native MCP Server

**facebook-ads-mcp** is the **first server in the fleet** to actively use both Workers AI and AI Gateway:

**AI Integration Architecture**:
```
Apify Actor → Raw Ad Data → AI Gateway → Workers AI (Llama 3) → Synthesized Hooks
     ↓                                        ↓
KV Cache (6h)                          AI Cache (1h)
```

**Comparison to Other Servers**:
- **linkedin-profile-scraper**: No AI (pure scraping)
- **youtube-transcript**: Workers AI binding configured, not used
- **facebook-page-profiler**: No AI
- **facebook-ads-mcp**: ✅ Active AI synthesis

### Dual-Layer Caching (KV + AI Gateway)

**Layer 1 - KV Cache (APIFY_CACHE)**:
- Purpose: Cache raw Apify Actor results
- TTL: 6 hours (longest in fleet)
- Benefit: Avoid re-scraping Facebook Ad Library

**Layer 2 - AI Gateway Cache**:
- Purpose: Cache AI-synthesized marketing hooks
- TTL: 1 hour
- Benefit: Avoid re-invoking Llama 3 model
- Cost Savings: Workers AI inference ~$0.001/request

**Cache Hit Scenarios**:
1. **KV HIT + AI HIT**: Return cached synthesis instantly (0ms AI)
2. **KV HIT + AI MISS**: Re-synthesize from cached ads (200ms AI)
3. **KV MISS**: Full scrape + synthesis (2000ms)

### Tiered Pricing Model (1-3-5 Pattern)

**Three-Tier Strategy**:
1. **Reconnaissance** (1 token): Quick activity check
2. **Visual Assets** (3 tokens): Creative gallery download
3. **Strategic Analysis** (5 tokens): AI-powered insights

**User Journey**:
```
checkActivityPulse (1 token)
    ↓ (if active)
fetchCreativeGallery (3 tokens)
    ↓ (for deep analysis)
analyzeCompetitorStrategy (5 tokens)
```

**Total Cost**: 9 tokens for complete competitive intelligence

**Comparison to Flat Pricing**:
- **Flat Model**: 5 tokens × 3 tools = 15 tokens
- **Tiered Model**: 1 + 3 + 5 = 9 tokens
- **Savings**: 40% discount for incremental analysis

### AI-Powered Marketing Hook Extraction

**Problem**: Raw ad texts are verbose and unstructured

**Solution**: AI synthesis via Workers AI (Llama 3 8B)

**Prompt Engineering**:
```typescript
`Analyze these Facebook ad texts and extract 3 key marketing hooks:

${adTexts.join('\n---\n')}

Return JSON: {"hooks": ["hook1", "hook2", "hook3"]}`
```

**Output Example**:
```json
{
  "hooks": [
    "60-day money-back guarantee",
    "Free shipping on orders over $50",
    "Join 10,000+ satisfied customers"
  ]
}
```

**Business Value**:
- Identify effective messaging patterns
- Reverse-engineer competitor positioning
- Inform copywriting strategy

**Error Resilience**:
- JSON parsing with try/catch fallback
- Empty array on parse failure
- No tool failure if AI unavailable

### Format Statistics (Video vs. Image Analysis)

**Automatic Creative Type Detection**:
```typescript
const isVideo = !!card?.video_hd_url;
const videoCount = rawAds.filter(ad => ad.snapshot?.cards?.[0]?.video_hd_url).length;
const imageCount = rawAds.length - videoCount;
```

**Output**:
```json
{
  "format_statistics": {
    "total": 10,
    "video_percentage": 60,
    "image_percentage": 40
  }
}
```

**Strategic Insights**:
- Video-heavy strategy → Performance-focused brand
- Image-heavy strategy → Static conversion ads
- Mixed strategy → A/B testing active

### 6-Hour Cache TTL (Longest in Fleet)

**Rationale**: Facebook ad campaigns run for days/weeks (not hours)

**Comparison**:
- **linkedin-profile-scraper**: 15 minutes (profiles change rarely)
- **youtube-transcript**: 15 minutes (transcripts immutable)
- **facebook-page-profiler**: 60 minutes (page info semi-static)
- **facebook-ads-mcp**: **6 hours** (ad campaigns persistent)

**Business Justification**:
- Ad campaigns typically run 7-14 days
- Creative refresh cycles: weekly
- 6-hour window captures 4 data points per day
- Balances freshness vs. API cost

**Cache Economics**:
- Cache HIT rate: ~60% (6-hour window)
- Cost savings: 60% × $0.03 Apify cost = $0.018/query saved
- User charged: 100% (paid cache model)
- Margin boost: 60% cache hit → 75% gross margin

---

## 12. AI Gateway Integration Details

### Configuration

**Gateway Settings** (wrangler.jsonc:187-201):
```json
{
  "vars": {
    "AI_GATEWAY_ID": "mcp-apify-gateway"
  }
}
```

**Secrets**:
- `AI_GATEWAY_TOKEN`: Required for cf-aig-authorization header

### makeAIGatewayRequest Function

**Signature**:
```typescript
await makeAIGatewayRequest(
  config: { gatewayId: string, token: string },
  provider: "workers-ai",
  modelId: "@cf/meta/llama-3-8b-instruct",
  input: { prompt: string },
  cacheTtl: 3600
)
```

**Return Value**:
```typescript
{
  success: boolean,
  data: { response: string } | null,
  error: string | null
}
```

### AI Gateway Benefits

**Rate Limiting**:
- 50 requests/minute per gateway
- Prevents Workers AI quota exhaustion
- Protects against abuse

**Response Caching**:
- 1-hour TTL (3600 seconds)
- Reduces redundant AI inference
- Cost savings: ~$0.001 per cached request

**Request Logging**:
- 10M log limit
- Visibility into AI usage patterns
- Debugging failed synthesis attempts

**Analytics**:
- Token consumption tracking
- Latency monitoring
- Error rate analysis

### AI Error Handling

**Fallback Strategy**:
```typescript
if (aiResponse.success) {
  try {
    marketingHooks = JSON.parse(aiResponse.data.response || '{"hooks": []}');
  } catch {
    marketingHooks = { hooks: [] };  // Fallback to empty
  }
} else {
  marketingHooks = { hooks: [] };  // AI unavailable
}
```

**No Tool Failure on AI Errors**:
- Tool returns format stats even if AI fails
- Marketing hooks optional (empty array acceptable)
- Resilient to AI Gateway outages

---

## 13. Pricing & Economics Analysis

### Cost Breakdown (Per-Tool)

**checkActivityPulse** (1 token = $0.01):
- Apify Actor: ~$0.005 (metadata only, fast)
- Workers AI: $0 (no AI)
- Gross Margin: ~50%

**fetchCreativeGallery** (3 tokens = $0.03):
- Apify Actor: ~$0.015 (medium scrape)
- Workers AI: $0 (no AI)
- Gross Margin: ~50%

**analyzeCompetitorStrategy** (5 tokens = $0.05):
- Apify Actor: ~$0.02 (full scrape, 10 ads)
- Workers AI: ~$0.001 (Llama 3 inference)
- AI Gateway: ~$0.0001 (routing overhead)
- Total Cost: ~$0.021
- Gross Margin: ~58%

### Cache Economics (6-Hour TTL)

**Effective Costs with 60% Cache Hit Rate**:

**analyzeCompetitorStrategy**:
- Cache HIT (60%): $0.05 revenue, $0 infra cost → **100% margin**
- Cache MISS (40%): $0.05 revenue, $0.021 cost → **58% margin**
- **Blended Margin**: 60% × 100% + 40% × 58% = **83.2%**

**Comparison to Shorter TTL** (15-minute cache):
- Cache HIT rate: ~20% (not 60%)
- Blended Margin: 20% × 100% + 80% × 58% = **66.4%**
- **Margin Improvement**: 83.2% - 66.4% = **+16.8 percentage points**

### Competitive Positioning

**Competitor Pricing** (Facebook ad intelligence):
- **AdEspresso**: $49/month (unlimited queries, ~4900 tokens equivalent)
- **BigSpy**: $99/month (unlimited queries, ~9900 tokens equivalent)
- **Manual Research**: $20/hour × 2 hours = $40 per deep analysis

**This MCP** (full competitive analysis):
- checkActivityPulse: 1 token = $0.01
- fetchCreativeGallery: 3 tokens = $0.03
- analyzeCompetitorStrategy: 5 tokens = $0.05
- **Total**: 9 tokens = $0.09 per competitor

**Value Proposition**:
- 99% cheaper than subscription tools ($0.09 vs. $49/month)
- 444× cheaper than manual research ($0.09 vs. $40)
- Pay-per-use (no subscription lock-in)
- AI-synthesized insights (not just raw data)

---

**End of Snapshot**