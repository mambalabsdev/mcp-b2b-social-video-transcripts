# B2B Social Video Transcripts MCP Server

[![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-b2b-social-video-transcripts%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-b2b-social-video-transcripts&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-b2b-social-video-transcripts)](https://www.npmjs.com/package/@mambalabsdev/mcp-b2b-social-video-transcripts) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-b2b-social-video-transcripts)](https://www.npmjs.com/package/@mambalabsdev/mcp-b2b-social-video-transcripts) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-b2b-social-video-transcripts)](https://github.com/mambalabsdev/mcp-b2b-social-video-transcripts/blob/main/LICENSE)

An MCP server for the Mamba Labs B2B Social Video Transcripts actor on Apify. Turn prospect videos into transcripts, pain points, and icebreakers.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool](#tool)
- [Inputs](#inputs)
- [Pricing](#pricing)
- [Full actor documentation](#full-actor-documentation)
- [License](#license)

## What it does

Reads public social videos and podcast episodes, transcribes them on your own speech-to-text key, and in outbound mode extracts pain points, buying signals, competitor mentions, and icebreakers on your own AI key.

All of the work runs on Apify. This package is a thin client that starts the actor run, waits for it, and hands back the dataset rows.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config (`claude_desktop_config.json`), Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "mamba-b2b-social-video-transcripts": {
      "command": "npx",
      "args": [
        "-y",
        "@mambalabsdev/mcp-b2b-social-video-transcripts"
      ],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Restart the client. The `b2b_social_video_transcripts` tool appears.

## Prerequisites

- Node.js 18 or newer.
- An Apify API token from [console.apify.com/account/integrations](https://console.apify.com/account/integrations), set as `APIFY_TOKEN`. The server lists its tool without a token; a call needs one.

## Example prompts

- "Transcribe these 3 TikTok videos and list the pain points each speaker mentions."
- "Watch these 5 podcast feeds and tell me which new episodes mention switching CRM tools."

## Tool

`b2b_social_video_transcripts`. One tool. Example arguments:

```json
{
  "mode": "transcript",
  "video_urls": [
    "https://www.tiktok.com/@washingtonpost/video/7198260520103841070"
  ]
}
```

## Inputs

Every buyer facing input of the actor. Omitted inputs take the actor's own defaults.

| Input | Type | Required | Description |
|---|---|---|---|
| `mode` | string | no | transcript (default): transcript, caption, creator, and counts for each video given. outbound: the same plus pain points, buying signals, competitor mentions, and icebreakers on your AI key. watch_list: checks creators, podcast feeds, podcast keywords, and Threads hashtags for videos earlier runs have not seen, and transcribes only those. |
| `video_urls` | array | no | TikTok video, Instagram reel, Facebook reel, X post, Threads post, podcast episode or RSS feed, Wistia page, or YouTube video URLs. A podcast feed URL reads its latest episodes, up to max_videos_per_creator. |
| `creators` | array | no | watch_list mode: profile URLs or platform:handle, for example instagram:hubspot, x:gong_io, facebook:HubSpot, threads:hubspot. TikTok has no creator feed without a login, so TikTok creators are refused with a free row. |
| `podcast_feeds` | array | no | Podcast RSS feed URLs. In watch_list mode each feed is watched for new episodes; in the other modes the latest episodes are read. |
| `podcast_keywords` | array | no | watch_list mode: search terms for finding podcast feeds through the iTunes search API; each feed found is watched. |
| `hashtags` | array | no | watch_list mode: Threads hashtags, without #. Hashtag pages on TikTok, Instagram, X, and Facebook need a login or do not list newest first, so only Threads is read. |
| `wistia_ids` | array | no | Wistia media IDs, or company page URLs that embed Wistia videos; the page is scanned for embedded media IDs. |
| `include_commenters` | boolean | no | yes or no (default no). On TikTok videos at or above webhook_min_score, adds one row per commenter: handle, name, profile URL, comment, time, likes. |
| `watch_list_name` | string | no | Names the stored watch list. Rows are also appended to a named dataset b2b-social-video-transcripts-<name>, and seen video IDs are kept in a named key-value store b2b-social-video-transcripts-<name>-state. Letters, numbers, and dashes; up to 28 characters. Default default. |
| `watch_list_depth` | string | no | transcript (default) or outbound: what runs on each new video in watch_list mode. |
| `max_videos_per_creator` | number | no | Most videos read per creator, feed, keyword result, or hashtag in one run. Default 10, up to 100. |
| `since_days` | number | no | Skips videos older than this many days. Default 30. |
| `topic_filter` | array | no | Keywords. A video whose caption, hashtags, and title match none of them is skipped before any speech-to-text call, as a free skipped_off_topic row. |
| `transcript_filter` | array | no | Keywords matched against the spoken words. Rows are kept, with transcript_match true or false. |
| `stt_provider` | string | no | openai (default), groq, deepgram, or assemblyai. Used for videos with no native subtitle or transcript. |
| `stt_api_key` | string | no | Your own key for the provider above. Without a key, only videos with native subtitles or transcripts are transcribed; the rest return a free no_speech_track row. Never stored or logged. |
| `stt_model` | string | no | Optional. With openai the default is gpt-4o-mini-transcribe in transcript mode and whisper-1 when timestamps are needed (outbound mode or include_segments yes), because only whisper-1 returns timestamps among OpenAI models. |
| `stt_fallback_provider` | string | no | Optional second provider, tried when the first refuses or fails. |
| `stt_fallback_api_key` | string | no | Your own key for the fallback provider. |
| `ai_provider` | string | no | openai (default), anthropic, or gemini. Used by outbound mode and for translation. |
| `ai_api_key` | string | no | Your own key for the AI provider. Without it, outbound mode returns transcripts only and charges no outbound-insights. Never stored or logged. |
| `ai_model` | string | no | Optional override. Defaults: gpt-4.1-mini (openai), claude-haiku-4-5 (anthropic), gemini-2.5-flash (gemini). |
| `my_company` | string | no | Your company name, so pain points and icebreakers fit your offer. |
| `my_product` | string | no | What you sell, in one line. |
| `competitors` | array | no | Brand names to flag when spoken. Each is matched exactly in the transcript and by the AI call. |
| `translate_to_english` | boolean | no | yes or no. Default yes in outbound mode, no in the other modes. Needs the AI key. |
| `include_segments` | boolean | no | yes or no (default no). Adds transcript_segments to each row. Outbound mode always fills them when the source gives timestamps. |
| `youtube_transcript_provider` | string | no | scrapecreators, searchapi, or supadata. YouTube videos are transcribed only through your own key with one of these services. |
| `youtube_transcript_api_key` | string | no | Your own key for the YouTube transcript provider above. Without it, YouTube URLs return a free row. |
| `youtube_transcript_fallback_provider` | string | no | Optional second YouTube transcript provider. |
| `youtube_transcript_fallback_api_key` | string | no | Your own key for the fallback YouTube provider. |
| `webhook_url` | string | no | Optional. Each new video row with buying_signal_score at or above webhook_min_score is sent here as a POST with a Slack compatible text field. |
| `webhook_min_score` | number | no | 0 to 100. Default 0 sends every video row. |
| `max_charge_usd` | number | no | Optional. The run stops before a charge that would pass this amount. Summary rows are always returned. |

## Pricing

Pay per event on Apify, billed to your Apify account. Prices in USD.

| Event | Free plan | Bronze | Silver | Gold |
|---|---|---|---|---|
| `video-transcript`, one video with a transcript, first 3 minutes included | $0.025 | $0.02375 | $0.0225 | $0.02125 |
| `transcript-minute`, each started minute after the first 3 | $0.008 | $0.0076 | $0.0072 | $0.0068 |
| `outbound-insights`, outbound fields for one video, outbound mode only | $0.02 | $0.019 | $0.018 | $0.017 |
| `creator-check`, one creator, feed, keyword, or hashtag checked | $0.005 | $0.00475 | $0.0045 | $0.00425 |
| `creator-check-residential`, one Instagram profile checked | $0.045 | $0.04275 | $0.0405 | $0.03825 |
| `commenter-row`, one TikTok commenter | $0.002 | $0.0019 | $0.0018 | $0.0017 |
| `apify-actor-start`, per run start | $0.0085 | $0.0085 | $0.0085 | $0.0085 |

Rows with no speech, off topic, not found, or blocked are free, and so is a refused input. Mamba Labs pays the platform costs of the run, Apify proxy traffic included.

## Full actor documentation

[apify.com/mambalabs/b2b-social-video-transcripts](https://apify.com/mambalabs/b2b-social-video-transcripts)

## License

MIT. See [LICENSE](LICENSE).
