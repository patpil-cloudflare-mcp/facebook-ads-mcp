# Facebook Ads MCP Server - Mini Snapshot

**Generated**: 2025-11-22

---

- **Human-Readable Name**: Facebook Ads MCP Server

- **Workers AI Status**: Active (@cf/meta/llama-3-8b-instruct)
- **AI Usage**: Marketing hooks synthesis in analyzeCompetitorStrategy tool

- **AI Gateway Status**: Enabled
- **Gateway ID**: mcp-apify-gateway (shared across all MCP servers)

- **Total Tools**: 3

  - Tool 1: analyzeCompetitorStrategy
    - **Description (Verbatim)**: "Analyze competitor Facebook ad creative strategy to identify format preferences and effective marketing hooks. Returns format statistics (video vs image percentage) and AI-synthesized marketing angles. Use this when you need to understand how a competitor structures their ad campaigns and what messaging resonates. ⚠️ This tool costs 5 tokens per use."
    - **Token Cost**: 5 tokens per use (1 token if no results)
    - **Input Schema**:
      - `facebook_page_url` (string, required): Facebook Page URL to analyze
      - `max_ads_to_analyze` (number, optional): Number of ads (1-50, default: 10)
    - Max Output Length: 10000 characters (post-sanitization)
    - **MCP Prompt Descriptions**: Not implemented

  - Tool 2: fetchCreativeGallery
    - **Description (Verbatim)**: "Fetch direct URLs to ad images and video thumbnails for visual inspiration. Returns curated list of creative assets with metadata. Use this when you need visual examples of a competitor's ad creatives. ⚠️ This tool costs 3 tokens per use."
    - **Token Cost**: 3 tokens per use (1 token if no creatives)
    - **Input Schema**:
      - `facebook_page_url` (string, required): Facebook Page URL to fetch creatives from
      - `limit` (number, optional): Number of assets (1-30, default: 10)
    - Max Output Length: 10000 characters (post-sanitization)
    - **MCP Prompt Descriptions**: Not implemented

  - Tool 3: checkActivityPulse
    - **Description (Verbatim)**: "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use."
    - **Token Cost**: 1 token per use (unconditional)
    - **Input Schema**:
      - `facebook_page_url` (string, required): Facebook Page URL to check
    - Max Output Length: 1000 characters (post-sanitization)
    - **MCP Prompt Descriptions**: Not implemented

* **PII Redaction (is active)**: Yes - pilpat-mcp-security v1.1.0 with Polish patterns (PESEL, ID cards, passports, phones, credit cards, SSN, bank accounts). Email and phone redaction disabled (business contacts in ad creatives).

* **Primary Domain**: https://facebook-ads-mcp.wtyczki.ai

* **AnythingLLM MCP Configuration**:
```json
{
  "mcpServers": {
    "facebook-ads": {
      "url": "https://facebook-ads-mcp.wtyczki.ai/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer wtyk_YOUR_API_KEY_HERE"
      }
    }
  }
}
```
Note: The server name ("facebook-ads") is a local identifier - change it to whatever you prefer.

* **Workers AI status (is active, model)**: Active - @cf/meta/llama-3-8b-instruct for marketing hooks synthesis

* **Caching strategy**: KV caching with 6-hour TTL (21600 seconds). Cache-before-semaphore pattern implemented. 100% Paid Cache - full tokens charged on cache hits. Rationale: Facebook ads change infrequently; long TTL reduces Apify costs while maintaining data relevance.

---

**Architecture Notes**:
- Apify Actor: `apify/facebook-ads-scraper` (shared across all 3 tools)
- Two-DO architecture: FacebookAdsMCP (per-user MCP handling) + ApifySemaphore (global 32-slot concurrency)
- AI Gateway integration: Routes AI requests for caching (1-hour TTL), rate limiting (50 req/min), logging
- Tiered pricing: 5/3/1 tokens reflecting analysis depth (AI-enhanced vs raw data vs quick check)
- Dual authentication: OAuth (server.ts) and API key (api-key-handler.ts) paths both fully implemented
- Security: Step 4.5 implemented in all 6 tool paths (3 OAuth + 3 API key)
- URL validation: Regex pattern validation for Facebook URLs before Actor execution
