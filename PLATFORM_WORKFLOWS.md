# Platform Automation Workflows

## Architecture Overview

### Smart Page Extraction Strategy
Instead of brittle CSS selectors that break when UI changes, we use:

1. **Full page text extraction** - Get all visible text
2. **Intelligent parsing** - Extract profile info from text patterns
3. **Fuzzy element finding** - Search by text content, not class names
4. **Multiple fallback strategies** - Try 3 different methods for each action

**Key principle:** Text content changes much slower than CSS classes.

---

## Instagram

### send_message Flow (3 Methods)

**Pre-requisite:** Profile context extraction (happens FIRST, before messaging)

#### Method 1: Inbox Messaging (for all users)

**Step 1: Navigate to Instagram Home**
- Click Instagram logo OR navigate to instagram.com
- Wait for app shell (check for `svg[aria-label="Home"]`)

**Step 2: Go to Inbox**
- Click: `svg[aria-label="Messenger"]` or `svg[aria-label="Direct"]`
- URL fallback: `/direct/inbox/`

**Step 3: Click New Message**
- Try: `button:has-text("New message")`
- Try: `button[aria-label="New message"]`
- Try: `svg[aria-label="New message"]`
- Try: `a[href="/direct/inbox/new/"]`

**Step 4: Search User**
- Type username with 20ms delay per character
- Wait 1 second for results

**Step 5: Select User**
- Use `findElementsByText(page, username)` with fuzzy matching
- Click first matching result
- Verify chat opened by checking for composer

**Success indicators:**
- Composer visible (`textarea` or `div[contenteditable="true"]`)
- No "User not found" error

---

#### Method 2: Profile Message Button (for public/followed accounts)

**Step 1: Navigate to Profile (via UI search, NOT direct URL)**
- Click search bar: `input[placeholder*="Search"]`
- Type username
- Find and click result matching username

**Step 2: Check Relationship Status**
- Extract: Following/Follower status
- Check: Can message? (private accounts we don't follow cannot be messaged this way)

**Step 3: Click Message Button**
- Try: `button:has-text("Message")`
- Try: `button[aria-label="Message"]`
- Try: `svg[aria-label="Direct"]`

**Success indicators:**
- Chat composer appears
- Can type message

---

#### Method 3: Explore Search (fallback)

**Step 1: Navigate to Explore**
- Click: `svg[aria-label="Explore"]`
- URL fallback: `/explore/`

**Step 2: Search and Navigate**
- Type username in search
- Click matching user
- Navigate to their profile

**Step 3: Message via Profile**
- Use Method 2 steps from profile

---

### Full Context Extraction

**Extract from profile page:**
```javascript
{
  username: string,
  name: string,
  bio: string,
  category: string,
  followers: string,
  following: string,
  isPrivate: boolean,
  isBusiness: boolean,
  relationship: 'following' | 'not_following' | 'pending',
  isFollowing: boolean,
  canMessage: boolean,
  recentPosts: [{ url, type: 'post' | 'reel' }],
  rawText: string
}
```

**Relationship Detection:**
- `isFollowing`: "Following" button visible
- `canMessage`: "Message" button visible
- `isPrivate`: "This Account is Private" text present

---

### engage_post Flow

**Like Post:**
1. Navigate to post (or profile → first post)
2. Find Like button via text search: `findElementsByText(page, 'Like')`
3. Click or use `extractPageContent` + find aria-label="Like"
4. Verify: Heart icon fills

**Comment on Post:**
1. Navigate to post
2. Find comment box: `findElementsByText(page, 'Add a comment')`
3. Focus and type AI-generated comment
4. Click Post button (NOT Share!)
5. Verify comment appears

**Post vs Share Button (CRITICAL):**
- Comments use: `button:has-text("Post")`
- Posts use: `button:has-text("Share")`
- Never click Share when commenting!

---

### Media Sending

**Images/Videos:**
1. In DM, find attachment button: `findElementsByText(page, 'Gallery')`
2. Click to open file picker
3. Use `input[type="file"]` to set file path
4. Wait 2 seconds for upload
5. Send message

---

## LinkedIn

### send_message Flow (3 Methods + Role Matching)

**Key Innovation:** Job role matching for name disambiguation

When searching for "Jagadeesh" who is a scientist:
- Search returns multiple "Jagadeesh" results
- Score each by role hint keywords (scientist, researcher, etc.)
- Pick best match based on headline similarity

---

#### Method 1: LinkedIn Messaging (existing connections)

**Step 1: Navigate to Messaging**
- Click: `svg[aria-label="Messaging"]` or `a[href="/messaging/"]`

**Step 2: New Message**
- Click: `button:has-text("New message")`

**Step 3: Search with Role Matching**
- Type name
- If multiple results, score by `roleHint` matching
- Select best match

**Role Matching Algorithm:**
```javascript
const hintWords = roleHint.toLowerCase().split(/\s+/);
people.forEach(p => {
  p.score = 0;
  hintWords.forEach(word => {
    if (p.headline.toLowerCase().includes(word)) p.score += 10;
  });
});
people.sort((a, b) => b.score - a.score);
```

---

#### Method 2: Connections Search

**Step 1: Navigate to My Network**
- Click: `svg[aria-label="My Network"]`
- Go to Connections tab

**Step 2: Search Connections**
- Use search box in connections page
- Find matching connection card

**Step 3: Click Message**
- Message button on connection card
- Opens conversation directly

---

#### Method 3: Profile Message/Connect

**Step 1: Search and Open Profile**
- Search via main search bar
- Click best matching result

**Step 2: Check Connection Status**
- `isConnected`: Message button visible
- `canConnect`: Connect button visible
- `isPending`: Pending button visible

**Step 3a: If Connected**
- Click Message button
- Chat opens

**Step 3b: If Not Connected**
- Click Connect button
- Click "Add a note" (to send message with request)
- Type in note composer (280 char limit)
- Send connection request

---

### Full Context Extraction

**Extract from profile page:**
```javascript
{
  identifier: string,
  name: string,
  headline: string,
  jobTitle: string,
  company: string,
  location: string,
  bio: string,
  followers: string,
  relationship: 'connected' | 'following' | 'pending' | 'none',
  isConnected: boolean,
  canConnect: boolean,
  isPending: boolean,
  experiences: string[],
  openToWork: boolean,
  hiring: boolean,
  rawText: string
}
```

---

### Role-Based Search

**Search People with Disambiguation:**
```javascript
linkedinSearchPeople(page, "Jagadeesh", "scientist at google")
// Returns ranked list, best match first
```

**Search Algorithm:**
1. Navigate to LinkedIn home
2. Click search bar
3. Type query
4. Press Enter
5. Extract page content
6. Parse Name/Headline/Location triplets
7. Score by role hint if provided
8. Return ranked results

---

## Chat History Extraction

### Instagram Chat History

**Extract from conversation page:**
```javascript
[
  { sender: "username", text: "Hey there!", role: "them" },
  { sender: "You", text: "Hi!", role: "me" },
  ...
]
```

**Heuristic:** Parse visible text, skip timestamps, pair sender names with messages

### LinkedIn Chat History

**Extract from messaging thread:**
```javascript
[
  { sender: "John Doe", text: "Interested in connecting", role: "them" },
  { sender: "You", text: "Sure!", role: "me" },
  ...
]
```

**Used for:** Context-aware reply generation

---

## Post Engagement Actions

### Like Post (All Platforms)

**Universal flow:**
1. Navigate to post URL OR find post on profile
2. Extract page content
3. Find element with text/aria-label "Like"
4. Click
5. Verify (look for filled heart or "Liked" text)

### Comment on Post

**Universal flow:**
1. Navigate to post
2. Find comment input via text search: "Add a comment", "Write a comment"
3. Focus and type AI-generated comment
4. Submit (Enter key or Post button)
5. Verify comment appears

### Share/Retweet/Repost

**Platform-specific:**
- **Instagram:** Share button (NOT for comments)
- **LinkedIn:** Share or Repost
- **Twitter:** Retweet
- **Facebook:** Share

---

## Media Sending

### Supported Media Types

| Platform | Images | Videos | Voice | Documents |
|----------|--------|--------|-------|-----------|
| Instagram | ✅ | ✅ | ❌ | ❌ |
| LinkedIn | ✅ | ✅ | ❌ | ✅ |
| Twitter | ✅ | ✅ | ❌ | ❌ |
| Facebook | ✅ | ✅ | ❌ | ✅ |
| WhatsApp | ✅ | ✅ | ✅ | ✅ |
| Gmail | ✅ | ✅ | ❌ | ✅ |

### Media Sending Flow

**Universal steps:**
1. Open conversation/composer
2. Find attachment button (via text: "Attach", "Gallery", "+" icon)
3. Click to open file picker OR directly use `input[type="file"]`
4. Set file path: `await fileInput.setInputFiles(path)`
5. Wait for upload (1-3 seconds)
6. Add caption if needed
7. Send

---

## Search Flows

### Search People (LinkedIn Example)

**Input:**
- `query`: Name to search
- `roleHint`: Optional job/company hint for disambiguation

**Output:**
```javascript
[
  {
    name: "Jagadeesh Kumar",
    headline: "Data Scientist at Google",
    location: "San Francisco Bay Area",
    score: 85  // If roleHint provided
  },
  ...
]
```

**Algorithm:**
1. Navigate to platform home
2. Click search input
3. Type query
4. Wait for results
5. Extract full page
6. Parse result structure
7. Score by role hint
8. Return ranked list

---

## UI Navigation Principles

### Never Use Direct URLs for Search

**BAD:**
```javascript
// Direct URL - breaks easily
await navigate(page, `https://instagram.com/${username}/`)
```

**GOOD:**
```javascript
// UI-based navigation
await clickSearchBar();
await typeUsername(username);
await clickFirstResult();
```

### Why UI Navigation?

1. **Session handling** - Platform redirects through login if needed
2. **Rate limiting** - Looks more natural
3. **Resilience** - Works even if URL structure changes
4. **Search intelligence** - Platforms suggest best matches

---

## Debugging Guide

### Console Log Pattern

All handlers follow this logging pattern:
```
[Platform] Starting action...
[Platform] Step X: description
[Platform] Using method: methodName
[Platform] Found: what was found
[Platform] Success/Fail: result
```

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Element not found" | UI changed | Use `findElementsByText` instead of CSS selectors |
| "Chat not opened" | Private account | Use inbox method instead of profile method |
| "Wrong person messaged" | Name collision | Use `roleHint` parameter for disambiguation |
| "Message not sent" | Composer not focused | Click composer before typing |
| "Attachment failed" | No file input | Click attachment button first |

### Testing Individual Flows

```javascript
// Test Instagram DM
const result = await instagramHandler.execute({
  step: {
    action: 'send_message',
    platform: 'instagram',
    args: {
      username: 'testuser',
      messageGoal: 'introduce service',
      tone: 'friendly'
    }
  },
  attachedBrowser
});

// Test LinkedIn with role hint
const result = await linkedinHandler.execute({
  step: {
    action: 'send_message',
    platform: 'linkedin',
    args: {
      username: 'John Doe',
      roleHint: 'software engineer at Google',
      messageGoal: 'job opportunity'
    }
  },
  attachedBrowser
});
```

---

## Implementation Files

### Core Utilities

**`packages/platform-skills/src/page-extractor.js`**
- `extractPageContent(page)` - Get all visible content
- `findElementsByText(page, text, options)` - Fuzzy element finding
- `parseProfileFromContent(content, platform)` - Extract profile data
- `detectRelationshipStatus(page, platform)` - Get follow/connect status

### Platform Handlers

**`packages/platform-skills/src/handlers/instagram.js`**
- 3 messaging methods (inbox, profile, explore)
- Relationship detection
- Media attachments
- Chat history extraction

**`packages/platform-skills/src/handlers/linkedin.js`**
- 3 messaging methods (messaging, connections, profile)
- Role-based search with disambiguation
- Connection request with note
- Job/company context extraction

### Common Functions

**`packages/platform-skills/src/common.js`**
- `generateOutreachMessage()` - AI message generation with context
- `navigate()` - Smart navigation with timeouts
- `waitForAppShell()` - Page ready detection

---

## Quick Reference

### Send Message (Universal)

```javascript
{
  action: 'send_message',
  platform: 'instagram|linkedin|twitter|facebook',
  args: {
    username: 'target_name',
    roleHint: 'optional_job_title',  // For LinkedIn disambiguation
    messageGoal: 'purpose_of_message',
    tone: 'friendly|professional|casual',
    query: 'additional_context',
    requireManualReview: false,
    attachmentPath: '/path/to/file.jpg'  // Optional
  }
}
```

### Search People (LinkedIn)

```javascript
{
  action: 'search_people',
  platform: 'linkedin',
  args: {
    query: 'John Doe',
    roleHint: 'software engineer'
  }
}
```

### Batch Messaging

```javascript
{
  action: 'message_batch',
  platform: 'linkedin',
  args: {
    people: [
      { name: 'John', roleHint: 'engineer' },
      { name: 'Jane', roleHint: 'designer' }
    ],
    messageGoal: 'event invitation',
    tone: 'professional'
  }
}
```
