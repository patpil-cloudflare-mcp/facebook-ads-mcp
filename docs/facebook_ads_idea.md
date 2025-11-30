{
  "startUrls": [
    { "url": "{{facebook_page_url}}" }
  ],
  "resultsLimit": {{max_ads_to_analyze}},
  "activeStatus": "active",
  "onlyTotal": {{tool_specific_boolean}},
  "isDetailsPerAd": {{tool_specific_boolean}},
  "proxy": { "useApifyProxy": true }
}
* 	**•	• Sample Raw Output (Snippet):**

⠀JSON


// From Tool C (Pulse)
{
  "totalCount": 50001,
  "pageName": "SHEIN",
  "startDateFormatted": "2025-02-14T08:00:00.000Z"
}
// From Tool A (Strategy) - Snapshot part
{
  "snapshot": {
    "body": { "text": "Become a fashionista!\nRefresh your wardrobe..." },
    "cards": [{ "originalImageUrl": "https://scontent..." }],
    "ctaText": "Install Now"
  }
}
## 4. Cloudflare Platform Capabilities
### 4.1. Caching Strategy (KV)
* 	**•	• Enabled:** Yes
* 	**•	• TTL (Time-To-Live):** **21600 seconds (6 hours)**.
* 	**•	• Cache Key Logic:** md5(tool_name + normalized_url + country).
* 	**•	• Goal:** "Profit Margin Protection. Competitive intelligence changes slowly. If User A checks 'Nike', and User B checks 'Nike' 1 hour later, User B gets cached data. System pays Apify ONCE, gets paid in tokens TWICE."

⠀**### 4.2. AI Gateway & Workers AI**
* 	**•	• Use AI Gateway?** Yes (for logging and rate limiting internal AI calls).
* 	**•	• Use Case:** **Post-Processing / Synthesis**. Raw ad texts are noisy. The server must distill them into "Strategy" before returning to the client to save the client's context window.
* 	**•	• Model Selection:** @cf/meta/llama-3-8b-instruct (Fast, cheap, sufficient for summarization).

⠀**### 4.3. Concurrency Control (Durable Objects)**
* 	**•	• Semaphore Limit:** **5 concurrent runs**.
* 	**•	• Reasoning:** Apify scraping is resource-intensive and long-running (20-60s). We limit concurrency strictly to prevent timeout cascades and API rate limits.
* 	**•	• Timeout Strategy:** **120s hard timeout**. If Apify hangs, release the slot and refund tokens (except 1 op fee).

⠀## 5. Deployment & Bindings
### Required Bindings
* 	**•	• Standard:** OAUTH_KV, USER_SESSIONS, TOKEN_DB, MCP_OBJECT (Durable Object Namespace).
* 	**•	• Apify-Specific:** APIFY_SEMAPHORE (DO for locking), APIFY_CACHE (KV), APIFY_API_TOKEN (Secret).
* 	**•	• AI-Specific:** AI (Workers AI Binding), AI_GATEWAY.

⠀## 6. User Experience (The "Synthesizer" Guide)
Note: How should the AI Assistant present this data to the user?
* 	•	• Recommended Prompt Template (User Intent):Template: "Check the ad strategy for [Brand Name]. Start with a volume check, and if they are active, analyze their visual format split and key messaging hooks."
* 	**•	• Visual Output Expectations:**
	* 	◦	◦ **For Tool A:** A structured summary. E.g., "**Strategy Overview:** 🎥 Video Heavy (70%) targeting Impulse Buyers." followed by a Markdown list of "Key Hooks".
	* 	◦	◦ **For Tool B:** A Markdown Image Grid (if supported) or a list of links formatted as [Image: Headline](url).