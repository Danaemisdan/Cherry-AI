# Cherry AI - Tools & Functions Roadmap

## Philosophy
- **Core Actions**: The atomic building blocks (send message, scrape profile, etc.)
- **Function Wrappers**: Higher-order functions that add capabilities (schedule, delay, batch, conditionals)
- **Agent-Guided Integrations**: For external tools (CRM, analytics), agent provides setup steps rather than direct integration

---

## CORE ACTIONS (Must Build First)

### 1. MESSAGING SUITE
| Action | Status | Notes |
|--------|--------|-------|
| `send_message` | ✅ | Text DMs on all platforms |
| `send_with_media` | 🆕 | Images, videos, audio, docs |
| `send_voice_note` | ❌ | Record or upload audio |
| `send_with_url_preview` | ❌ | Links with rich cards |
| `send_html_email` | ❌ | Rich formatting for Gmail |
| `draft_message` | ✅ | Generate without sending |
| `message_batch` | ✅ | Multiple recipients |
| `reply_to_message` | ❌ | Contextual replies |

### 2. ENGAGEMENT SUITE
| Action | Status | Notes |
|--------|--------|-------|
| `like_post` | ✅ | Auto-like by username |
| `comment_on_post` | ✅ | AI-generated comments |
| `follow_user` | ✅ | Follow/connect action |
| `share_post` | ❌ | Repost/retweet |
| `save_bookmark` | ❌ | Private saves |
| `report_post` | ❌ | Flag content |

### 3. POSTING SUITE
| Action | Status | Notes |
|--------|--------|-------|
| `create_post` | ✅ | Text posts |
| `create_post_with_image` | ✅ | Image + caption |
| `create_post_with_video` | ❌ | Video + caption |
| `create_story` | ❌ | 24hr disappearing |
| `create_reel/short` | ❌ | Short-form video |
| `create_poll` | ❌ | Survey/engagement |
| `create_article` | ❌ | LinkedIn long-form |
| `create_newsletter` | ❌ | LinkedIn newsletter |
| `schedule_post` | ❌ | Post later (function wrapper) |

### 4. LEAD SCRAPING SUITE
| Action | Status | Notes |
|--------|--------|-------|
| `scrape_profile` | ✅ | Basic profile info |
| `scrape_contact_info` | ✅ | Email, phone, links |
| `scrape_leads` | ✅ | Bulk profile collection |
| `scrape_from_search` | ✅ | Search → profiles |
| `scrape_job_postings` | ❌ | Job boards → leads |
| `scrape_event_attendees` | ❌ | Event → attendees |
| `scrape_group_members` | ❌ | Group → members |
| `scrape_competitor_followers` | ❌ | Their audience |
| `download_web_image` | ❌ | Save images from URLs |
| `download_web_video` | ❌ | Save videos from URLs |

### 5. RESEARCH SUITE
| Action | Status | Notes |
|--------|--------|-------|
| `google_search` | ✅ | Web search |
| `google_news_search` | ❌ | News results |
| `google_trends_check` | ❌ | Trending topics |
| `hashtag_research` | ❌ | Trending hashtags |
| `company_research` | ❌ | Enrich company data |
| `person_research` | ❌ | Deep person lookup |
| `verify_email` | ❌ | Email validation |
| `verify_phone` | ❌ | Phone validation |

### 6. UTILITY SUITE
| Action | Status | Notes |
|--------|--------|-------|
| `take_screenshot` | ❌ | Capture page/element |
| `generate_meme` | ❌ | Text on image |
| `generate_thumbnail` | ❌ | YouTube style |
| `generate_caption` | ✅ | AI caption generation |
| `summarize_content` | ❌ | TL;DR any text |
| `translate_message` | ❌ | Multi-language |
| `text_to_speech` | ❌ | Generate audio |
| `speech_to_text` | ❌ | Transcribe audio |
| `export_to_csv` | ❌ | Data export |
| `export_to_pdf` | ❌ | Report generation |

---

## FUNCTION WRAPPERS (Higher-Order Functions)

These wrap core actions to add capabilities:

### 1. SCHEDULING & DELAY
```javascript
// Function wrapper pattern
async function withDelay(action, delayMs) {
  await new Promise(r => setTimeout(r, delayMs));
  return await action();
}

async function withSchedule(action, dateTime) {
  const delay = new Date(dateTime) - new Date();
  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay));
  }
  return await action();
}
```

| Wrapper | Description |
|---------|-------------|
| `delay(action, ms)` | Wait X ms before executing |
| `schedule(action, datetime)` | Execute at specific time |
| `recurring(action, cron)` | Repeat on schedule |
| `rateLimit(action, minDelay)` | Ensure minimum gap between calls |

### 2. BATCHING & LOOPING
| Wrapper | Description |
|---------|-------------|
| `batch(actions[], concurrency)` | Run multiple, limit parallel |
| `sequence(actions[])` | Run one after another |
| `retry(action, attempts)` | Retry on failure |
| `timeout(action, ms)` | Fail if takes too long |

### 3. CONDITIONAL LOGIC
| Wrapper | Description |
|---------|-------------|
| `ifThen(condition, action)` | Conditional execution |
| `ifElse(condition, actionA, actionB)` | Branching logic |
| `while(condition, action)` | Loop while true |
| `filter(data[], condition)` | Filter before action |

### 4. DATA TRANSFORM
| Wrapper | Description |
|---------|-------------|
| `withContext(action, extraData)` | Inject additional context |
| `withTemplate(action, template)` | Format output |
| `withVariation(action, variants[])` | A/B testing |

---

## AGENT-GUIDED INTEGRATIONS

Instead of direct integration, agent provides setup steps:

### CRM Integrations
| Integration | Setup Steps Provided |
|-------------|---------------------|
| **HubSpot** | API key setup, webhook URL, field mapping guide |
| **Salesforce** | Connected app setup, OAuth flow, object mapping |
| **Pipedrive** | API token, pipeline setup, stage mapping |
| **Zoho CRM** | API auth, module mapping, workflow rules |

### Analytics Integrations
| Integration | Setup Steps Provided |
|-------------|---------------------|
| **Google Analytics** | Tracking code, goal setup, event tracking |
| **Mixpanel** | Project token, event schema, user profiles |
| **Amplitude** | API key, event taxonomy, cohort setup |

### Communication Integrations
| Integration | Setup Steps Provided |
|-------------|---------------------|
| **Slack** | Bot token, channel IDs, webhook URLs |
| **Discord** | Bot token, server ID, channel mapping |
| **Telegram** | Bot token, chat ID, webhook setup |
| **Twilio** | Account SID, auth token, phone number |
| **SendGrid** | API key, sender authentication, templates |

### Storage Integrations
| Integration | Setup Steps Provided |
|-------------|---------------------|
| **Google Drive** | OAuth, folder ID, sharing settings |
| **Dropbox** | App key, folder path, sharing rules |
| **AWS S3** | Access key, bucket, region, IAM |
| **Supabase** | URL, anon key, table schema |

### Automation Integrations
| Integration | Setup Steps Provided |
|-------------|---------------------|
| **Zapier** | Webhook URL, trigger setup, action mapping |
| **Make/Integromat** | Scenario ID, webhook, data mapping |
| **n8n** | Workflow JSON, credential setup, webhook |

---

## PLATFORM-SPECIFIC FEATURES

### LinkedIn
- [ ] **Articles** - Long-form publishing
- [ ] **Newsletters** - Subscription-based
- [ ] **Events** - Create and promote
- [ ] **Live Audio** - LinkedIn Audio Events
- [ ] **Voice Messages** - 60sec audio DMs
- [ ] **Recommendations** - Give/get recommendations
- [ ] **Skills Endorsements** - Bulk endorse
- [ ] **Project Showcase** - Add to profile

### Instagram
- [ ] **Reels** - Short video with music
- [ ] **Stories** - 24hr content with stickers
- [ ] **Story Replies** - Reply to stories
- [ ] **Shop Tagging** - Product tags
- [ ] **Guides** - Curated content
- [ ] **Collab Posts** - Co-authored
- [ ] **Broadcast Channels** - One-to-many messaging
- [ ] **Notes** - Status updates

### Twitter/X
- [ ] **Spaces** - Audio rooms
- [ ] **Communities** - Group posting
- [ ] **Super Follows** - Paid content
- [ ] **Tips** | Send/receive tips
- [ ] **Newsletters** | Revue integration
- [ ] **Twitter Blue** | Premium features

### Facebook
- [ ] **Groups** - Post and engage
- [ ] **Events** | Create/manage
- [ ] **Marketplace** | List items
- [ ] **Pages** | Manage business
- [ ] **Stories** | Cross-post
- [ ] **Reels** | Cross-post

### YouTube
- [ ] **Video Upload** | Long-form
- [ ] **Shorts** | Vertical short
- [ ] **Community Posts** | Text/image
- [ ] **Premieres** | Scheduled debut
- [ ] **Live Streaming** | Go live
- [ ] **Playlists** | Manage
- [ ] **Comments** | Engage

---

## DEVELOPMENT PHASES

### Phase 1: Core Infrastructure ✅
- [x] Basic browser automation
- [x] Login state management
- [x] Platform handlers (LI, IG, TW, FB, WA, Gmail)
- [x] Message sending
- [x] Chat context extraction
- [x] Media upload support

### Phase 2: Complete Core Actions ⏳
- [ ] Reply detection & auto-reply
- [ ] Voice message recording/upload
- [ ] Video message support
- [ ] URL preview in messages
- [ ] HTML email templates
- [ ] Story/Reels posting
- [ ] Poll creation
- [ ] Job scraping
- [ ] Image/video downloading
- [ ] Webhook/API endpoints

### Phase 3: Function Wrappers ⏳
- [ ] Scheduling engine
- [ ] Delay/rate limiting
- [ ] Batch processing
- [ ] Conditional logic builder
- [ ] Template system
- [ ] A/B testing framework
- [ ] Retry logic

### Phase 4: Agent Intelligence ⏳
- [ ] Tool selection reasoning
- [ ] Multi-step workflow execution
- [ ] Error recovery
- [ ] Context memory
- [ ] User preference learning

### Phase 5: Dashboard & Metrics ⏳
- [ ] Campaign analytics
- [ ] Lead pipeline view
- [ ] Engagement metrics
- [ ] ROI tracking
- [ ] Team collaboration
- [ ] Report generation

### Phase 6: Advanced Features ⏳
- [ ] AI image generation
- [ ] AI video generation
- [ ] Voice cloning
- [ ] Smart scheduling
- [ ] Predictive analytics
- [ ] Competitor monitoring

---

## USAGE EXAMPLES

### Example 1: Scheduled Campaign
```javascript
// Schedule LinkedIn messages for tomorrow 9am
const leads = await scrape_leads({ platform: 'linkedin', query: 'founders' });

for (const lead of leads.slice(0, 10)) {
  await schedule(
    () => send_message({
      platform: 'linkedin',
      username: lead.username,
      messageGoal: 'Introduce service'
    }),
    '2024-01-15T09:00:00' // 9am tomorrow
  );
}
```

### Example 2: Conditional Outreach
```javascript
// Only message if they have "Open to Work" badge
const status = await scrape_profile({ username: 'john_doe' });

await ifThen(
  () => status.openToWork,
  () => send_message({
    username: 'john_doe',
    messageGoal: 'Job opportunity'
  })
);
```

### Example 3: Batch with Rate Limit
```javascript
// Send 50 messages, max 5 per minute
await batch(
  leads.map(l => () => send_message({ username: l.username })),
  { concurrency: 1, delay: 12000 } // 12s between each
);
```

### Example 4: Multi-Platform Blast
```javascript
// Post to all platforms at once
await batch([
  () => create_post({ platform: 'linkedin', content: 'Update' }),
  () => create_post({ platform: 'twitter', content: 'Update' }),
  () => create_post({ platform: 'instagram', content: 'Update' }),
], { concurrency: 3 });
```

---

## INTEGRATION GUIDE TEMPLATE

When agent guides user through integration:

```
1. Sign up for [SERVICE] at [URL]
2. Get your API key from [LOCATION]
3. Set environment variable: export [SERVICE]_API_KEY=your_key
4. Configure webhook URL: https://your-domain.com/webhook/[SERVICE]
5. Map fields: [SERVICE_FIELD] → [CHERRY_FIELD]
6. Test connection
7. Enable in Cherry dashboard
```

---

## PRIORITY ORDER

### Must Build Next (Core Actions)
1. `reply_to_message` - Contextual replies
2. `create_post_with_video` - Video content
3. `create_story` - Stories/Reels
4. `download_web_image` - Media grabbing
5. `schedule_post` - Time-based posting
6. `verify_email` - Lead validation
7. `export_to_csv` - Data export
8. `webhook_endpoint` - External triggers

### Then Function Wrappers
1. `schedule()` - Time-based execution
2. `delay()` - Paused execution
3. `batch()` - Parallel processing
4. `retry()` - Fault tolerance
5. `ifThen()` - Conditional logic

### Then Agent Intelligence
1. Tool selection reasoning
2. Multi-step workflow execution
3. Error recovery patterns

---

## NOTES

- **No Direct Integrations**: Agent provides steps, user sets up
- **Function Wrappers Are Key**: They make simple actions powerful
- **Core Actions First**: Don't build dashboard before tools work
- **Test Each Tool**: Must work reliably before next phase
- **Document Everything**: Every tool needs usage examples

---

**Last Updated**: 2024-01
**Status**: Phase 2 in progress
