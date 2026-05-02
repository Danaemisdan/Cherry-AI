# Cherry AI - Complete Implementation Plan

## Vision
Autonomous social media manager that:
1. Parses natural language intent from chat
2. Executes complex multi-platform workflows silently in background
3. Extracts and stores context (chats, profiles, contacts) continuously
4. Makes intelligent decisions based on stored data

---

## Phase 1: Speed & Reliability (NOW)

### 1.1 Fix 60s Timeout Issues
- [ ] Audit all `waitForTimeout()` calls - replace with smart waits
- [ ] Add element-ready checks before interactions
- [ ] Reduce LinkedIn step time from 5 mins to 30 seconds
- [ ] Add timeout configuration per platform

### 1.2 Background Operation
- [ ] Disable tab/window focusing in CDP controller
- [ ] Run all browser operations in unfocused tabs
- [ ] Agent works silently without disturbing user

### 1.3 Smart Waits
- [ ] Check if element already exists before waiting
- [ ] Use `waitForSelector` with short timeout instead of fixed delays
- [ ] Parallel loading of non-critical elements
- [ ] Skip waits for already-loaded pages

---

## Phase 2: Context Extraction (This Week)

### 2.1 Chat Context Extraction
Platforms: WhatsApp, Instagram, Facebook, LinkedIn

For each platform:
- [ ] Scrape conversation history (last 10-20 messages)
- [ ] Extract: sender, text, timestamp, message type
- [ ] Store in dashboard database
- [ ] Make available for `generateOutreachMessage()`

### 2.2 Profile Info Extraction
For each person encountered:
- [ ] Bio/description
- [ ] Recent posts (last 3-5)
- [ ] Follower/following count
- [ ] Job title & company (LinkedIn)
- [ ] Profile URL
- [ ] Store in contacts database

### 2.3 Contact Builder
- [ ] Auto-add every person messaged to dashboard
- [ ] Track: last contact, message history, profile info
- [ ] Deduplication across platforms
- [ ] Searchable contact database

---

## Phase 3: Missing Actions (This Week)

### 3.1 Reply Action
Currently detected but not implemented:
- [ ] Add `reply` handler in social-base.js
- [ ] Extract chat context automatically
- [ ] Generate contextual reply using chat history
- [ ] Works on: WhatsApp, IG, FB, LinkedIn, Twitter

### 3.2 Scroll Actions
- [ ] `scroll_reels` - Instagram reels feed
- [ ] `scroll_feed` - LinkedIn/Twitter/FB feed
- [ ] Extract engagement data while scrolling
- [ ] Optional: auto-engage with high-value posts

### 3.3 YouTube Module
- [ ] Search videos
- [ ] Extract transcripts
- [ ] Summarize content
- [ ] Store for content ideas

---

## Phase 4: Research Quality (This Week)

### 4.1 Fix Google Search
- [ ] Filter navigation links from results
- [ ] Prioritize actual content pages
- [ ] Better snippet extraction
- [ ] Handle CAPTCHAs gracefully

### 4.2 Multi-Engine Search
- [ ] DuckDuckGo fallback
- [ ] LinkedIn native search (already fixed)
- [ ] Twitter/X search
- [ ] Instagram hashtag search

---

## Phase 5: Intelligence & Flow (Next Week)

### 5.1 Intent Matching
Natural language → Action mapping:
- "Reply to Jagadeesh" → find chat → extract context → reply
- "Message founders about my product" → search → scrape → message
- "Check my DMs" → open all platforms → extract unread → summarize

### 5.2 Smart Combining
Single task, multiple actions:
- Find + Scrape + Message in one flow
- Research + Draft + Send without manual steps
- Auto-continue from partial failures

### 5.3 Result Storage
- [ ] Every task updates dashboard automatically
- [ ] Contact lists export to CSV + dashboard
- [ ] Message history stored
- [ ] Success/failure tracking per contact

---

## Phase 6: Full Autonomy (Future)

### 6.1 Background Workers
- [ ] Inbox watchers (continuous monitoring)
- [ ] Auto-reply to common queries
- [ ] Lead warming campaigns
- [ ] Follow-up reminders

### 6.2 Content Creation
- [ ] Canva API integration
- [ ] Google Veo video generation
- [ ] Auto-post scheduling
- [ ] Content calendar management

### 6.3 Analytics
- [ ] Follower growth tracking
- [ ] Lead conversion pipeline
- [ ] Meeting booking metrics
- [ ] Campaign performance dashboard

---

## Immediate Priority (Do Now)

1. **Background Operation** - Stop focusing tabs
2. **60s Timeout Fix** - Speed up LinkedIn
3. **Smart Waits** - Replace fixed delays
4. **Reply Action** - Critical missing piece
5. **Chat Context** - Enable smart replies

---

## Status

| Phase | Progress | Status |
|-------|----------|--------|
| Platform Fixes | 10/10 | ✅ Complete |
| AI Messages | 5/5 | ✅ Complete |
| Speed/Reliability | 0/3 | 🔄 In Progress |
| Context Extraction | 0/3 | ⏳ Pending |
| Missing Actions | 0/3 | ⏳ Pending |
| Research Quality | 0/2 | ⏳ Pending |
| Intelligence | 0/3 | ⏳ Pending |

Last Updated: 2024-05-02
