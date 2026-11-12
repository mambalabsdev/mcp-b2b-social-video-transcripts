#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. Fleet standard
// (standing build rule 5, 2026-10-05). A run of 50 searches of 100 posts each
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

// The actor's number and on or off inputs are text fields (Apify checks input
// types before the actor starts, and Clay sends text), so numbers and booleans
// from the model are sent as text.
function asActorInput(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(compact(args))) {
    out[k] = typeof v === "number" || typeof v === "boolean" ? String(v) : v;
  }
  return out;
}

const server = new McpServer({
  name: "mamba-b2b-social-video-transcripts",
  version: pkg.version,
});

// B2B Social Video Transcripts (immutable actor ID dG2UYVKE2e4zfDucK). Every buyer facing input of the actor is exposed.
server.registerTool(
  "b2b_social_video_transcripts",
  {
    title: "B2B Social Video Transcripts",
    description:
      "Get transcripts of public TikTok, Instagram Reels, Facebook Reels, X, Threads, podcast, and Wistia videos, and in outbound mode pull pain points, buying signals, competitor mentions, and icebreakers with timestamps. Speech-to-text and AI calls run on the buyer's own API keys.",
    annotations: {
      title: "B2B Social Video Transcripts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      mode: z.enum(["transcript","outbound","watch_list"]).optional().describe("transcript (default): transcript, caption, creator, and counts for each video given. outbound: the same plus pain points, buying signals, competitor mentions, and icebreakers on your AI key. watch_list: checks creators, podcast feeds, podcast keywords, and Threads hashtags for videos earlier runs have not seen, and transcribes only those."),
      video_urls: z.array(z.string()).optional().describe("TikTok video, Instagram reel, Facebook reel, X post, Threads post, podcast episode or RSS feed, Wistia page, or YouTube video URLs. A podcast feed URL reads its latest episodes, up to max_videos_per_creator."),
      creators: z.array(z.string()).optional().describe("watch_list mode: profile URLs or platform:handle, for example instagram:hubspot, x:gong_io, facebook:HubSpot, threads:hubspot. TikTok has no creator feed without a login, so TikTok creators are refused with a free row."),
      podcast_feeds: z.array(z.string()).optional().describe("Podcast RSS feed URLs. In watch_list mode each feed is watched for new episodes; in the other modes the latest episodes are read."),
      podcast_keywords: z.array(z.string()).optional().describe("watch_list mode: search terms for finding podcast feeds through the iTunes search API; each feed found is watched."),
      hashtags: z.array(z.string()).optional().describe("watch_list mode: Threads hashtags, without #. Hashtag pages on TikTok, Instagram, X, and Facebook need a login or do not list newest first, so only Threads is read."),
      wistia_ids: z.array(z.string()).optional().describe("Wistia media IDs, or company page URLs that embed Wistia videos; the page is scanned for embedded media IDs."),
      include_commenters: z.boolean().optional().describe("yes or no (default no). On TikTok videos at or above webhook_min_score, adds one row per commenter: handle, name, profile URL, comment, time, likes."),
      watch_list_name: z.string().optional().describe("Names the stored watch list. Rows are also appended to a named dataset b2b-social-video-transcripts-<name>, and seen video IDs are kept in a named key-value store b2b-social-video-transcripts-<name>-state. Letters, numbers, and dashes; up to 28 characters. Default default."),
      watch_list_depth: z.enum(["transcript","outbound"]).optional().describe("transcript (default) or outbound: what runs on each new video in watch_list mode."),
      max_videos_per_creator: z.number().optional().describe("Most videos read per creator, feed, keyword result, or hashtag in one run. Default 10, up to 100."),
      since_days: z.number().optional().describe("Skips videos older than this many days. Default 30."),
      topic_filter: z.array(z.string()).optional().describe("Keywords. A video whose caption, hashtags, and title match none of them is skipped before any speech-to-text call, as a free skipped_off_topic row."),
      transcript_filter: z.array(z.string()).optional().describe("Keywords matched against the spoken words. Rows are kept, with transcript_match true or false."),
      stt_provider: z.enum(["openai","groq","deepgram","assemblyai"]).optional().describe("openai (default), groq, deepgram, or assemblyai. Used for videos with no native subtitle or transcript."),
      stt_api_key: z.string().optional().describe("Your own key for the provider above. Without a key, only videos with native subtitles or transcripts are transcribed; the rest return a free no_speech_track row. Never stored or logged."),
      stt_model: z.string().optional().describe("Optional. With openai the default is gpt-4o-mini-transcribe in transcript mode and whisper-1 when timestamps are needed (outbound mode or include_segments yes), because only whisper-1 returns timestamps among OpenAI models."),
      stt_fallback_provider: z.enum(["openai","groq","deepgram","assemblyai"]).optional().describe("Optional second provider, tried when the first refuses or fails."),
      stt_fallback_api_key: z.string().optional().describe("Your own key for the fallback provider."),
      ai_provider: z.enum(["openai","anthropic","gemini"]).optional().describe("openai (default), anthropic, or gemini. Used by outbound mode and for translation."),
      ai_api_key: z.string().optional().describe("Your own key for the AI provider. Without it, outbound mode returns transcripts only and charges no outbound-insights. Never stored or logged."),
      ai_model: z.string().optional().describe("Optional override. Defaults: gpt-4.1-mini (openai), claude-haiku-4-5 (anthropic), gemini-2.5-flash (gemini)."),
      my_company: z.string().optional().describe("Your company name, so pain points and icebreakers fit your offer."),
      my_product: z.string().optional().describe("What you sell, in one line."),
      competitors: z.array(z.string()).optional().describe("Brand names to flag when spoken. Each is matched exactly in the transcript and by the AI call."),
      translate_to_english: z.boolean().optional().describe("yes or no. Default yes in outbound mode, no in the other modes. Needs the AI key."),
      include_segments: z.boolean().optional().describe("yes or no (default no). Adds transcript_segments to each row. Outbound mode always fills them when the source gives timestamps."),
      youtube_transcript_provider: z.enum(["scrapecreators","searchapi","supadata"]).optional().describe("scrapecreators, searchapi, or supadata. YouTube videos are transcribed only through your own key with one of these services."),
      youtube_transcript_api_key: z.string().optional().describe("Your own key for the YouTube transcript provider above. Without it, YouTube URLs return a free row."),
      youtube_transcript_fallback_provider: z.enum(["scrapecreators","searchapi","supadata"]).optional().describe("Optional second YouTube transcript provider."),
      youtube_transcript_fallback_api_key: z.string().optional().describe("Your own key for the fallback YouTube provider."),
      webhook_url: z.string().optional().describe("Optional. Each new video row with buying_signal_score at or above webhook_min_score is sent here as a POST with a Slack compatible text field."),
      webhook_min_score: z.number().optional().describe("0 to 100. Default 0 sends every video row."),
      max_charge_usd: z.number().optional().describe("Optional. The run stops before a charge that would pass this amount. Summary rows are always returned."),
    },
  },
  async (args) => runActor("dG2UYVKE2e4zfDucK", "B2B Social Video Transcripts", asActorInput(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
