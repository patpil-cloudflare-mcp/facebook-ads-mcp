/**
 * Tool Descriptions and Titles (SDK 1.20+)
 *
 * IMPORTANT: These descriptions must be IDENTICAL between OAuth and API key paths.
 * Using shared constants ensures dual-auth consistency.
 */

export const TOOL_DESCRIPTIONS = {
  ANALYZE_COMPETITOR_STRATEGY: "Analyze competitor Facebook ad creative strategy to identify format preferences and effective marketing hooks. Returns format statistics (video vs image percentage) and AI-synthesized marketing angles. Use this when you need to understand how a competitor structures their ad campaigns and what messaging resonates. ⚠️ This tool costs 5 tokens per use.",
  FETCH_CREATIVE_GALLERY: "Fetch direct URLs to ad images and video thumbnails for visual inspiration. Returns curated list of creative assets with metadata. Use this when you need visual examples of a competitor's ad creatives. ⚠️ This tool costs 3 tokens per use.",
  CHECK_ACTIVITY_PULSE: "Quick check to see if a brand is currently running Facebook ads and how many. Returns activity status and total ad count. Use this for initial reconnaissance before deeper analysis. ⚠️ This tool costs 1 token per use.",
};

export const TOOL_TITLES = {
  ANALYZE_COMPETITOR_STRATEGY: "Analyze Competitor Strategy",
  FETCH_CREATIVE_GALLERY: "Fetch Creative Gallery",
  CHECK_ACTIVITY_PULSE: "Check Activity Pulse",
};
