import { z } from 'zod';

export const PLATFORM_IDS = [
  'instagram',
  'twitter',
  'linkedin',
  'facebook',
  'gmail',
  'whatsapp',
  'research',
  'chatgpt',
  'gemini',
];

export const PlatformIdSchema = z.enum(PLATFORM_IDS);
export const BrowserModeSchema = z.enum(['attached', 'managed']);

export const QuietHoursSchema = z.object({
  timezone: z.string(),
  windows: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
    }),
  ),
});

export const LeadSourceConfigSchema = z.object({
  sourceType: z.enum(['search_engine', 'target_site']),
  engine: z.enum(['duckduckgo', 'google']).optional(),
  query: z.string().optional(),
  domains: z.array(z.string()).optional(),
  browserMode: z.literal('managed'),
});

export const StopRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily_cap_reached') }),
  z.object({ type: z.literal('positive_reply_target'), count: z.number().int().positive() }),
  z.object({ type: z.literal('consecutive_failures'), count: z.number().int().positive() }),
  z.object({ type: z.literal('manual_stop') }),
  z.object({ type: z.literal('auth_invalid') }),
]);

export const CampaignCapsSchema = z.object({
  perPlatformDailyActions: z.record(z.string(), z.number().int().nonnegative()).default({}),
  perPlatformDailyMessages: z.record(z.string(), z.number().int().nonnegative()).default({}),
  maxConcurrentTabs: z.number().int().positive().default(4),
  maxConcurrentConversations: z.number().int().positive().default(2),
});

export const PlanStepSchema = z.object({
  id: z.string(),
  platform: PlatformIdSchema,
  browserMode: BrowserModeSchema,
  action: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  successCriteria: z.string(),
  retryPolicy: z.object({
    maxAttempts: z.number().int().positive().default(2),
    replanOnFailure: z.boolean().default(true),
  }),
});

export const ExecutionPlanSchema = z.object({
  taskId: z.string(),
  objective: z.string(),
  targetPlatforms: z.array(PlatformIdSchema),
  steps: z.array(PlanStepSchema),
});

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.string(),
  platforms: z.array(PlatformIdSchema),
  browserStrategy: z.object({
    defaultMode: z.enum(['attached', 'managed', 'auto']).default('auto'),
    perPlatform: z.record(z.string(), BrowserModeSchema).default({}),
  }),
  schedules: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      cadenceMinutes: z.number().int().positive(),
    }),
  ),
  caps: CampaignCapsSchema,
  quietHours: QuietHoursSchema,
  targets: z.object({
    usernames: z.array(z.string()).default([]),
    emails: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
    notes: z.string().default(''),
  }),
  leadSources: z.array(LeadSourceConfigSchema).default([]),
  stopRules: z.array(StopRuleSchema).default([]),
  contentPolicy: z.object({
    tone: z.string().default('Casual and brief'),
    outreachGoal: z.string().default('Get a meeting'),
    allowAutonomousReplies: z.boolean().default(true),
  }),
  status: z.enum(['draft', 'active', 'paused', 'stopped']).default('draft'),
});

export const TASK_OPERATIONS = [
  'open_workspace',
  'find_leads',
  'send_message',
  'message_batch',
  'lead_and_message',
  'follow_and_message',
  'scrape_and_message',
  'run_campaign',
  'research',
  'scrape_profiles',
  'execute_deep_scrape',
  'scrape_followers',
  'auto_dm',
  'auto_dm_contact',
  'auto_dm_new',
  'like_ai_comment',
  'follow_user',
  'follow_search',
  'connect',
  'connect_swn',
  'connect_sn',
  'auto_post',
  'bulk_dm_csv',
  'bulk_engage_csv',
  'bulk_follow_csv',
  'open_status',
  'post_status',
  'change_profile_photo',
  'delete_chat',
  'block_user',
  'report_user',
  'map_contacts',
  'ask',
  'chat',
  'generate_image',
  'upload_file',
  'like_post',
  'comment_post',
  'engage_post',
  // Image pipeline
  'download_image',
  'send_image_dm',
  'generate_and_post',
  'generate_and_dm',
  'upload_to_ai',
  'get_context',
  'get_profile_context',
  'reply_to_email',
];

export const CANONICAL_SKILL_ACTIONS = [
  'open_workspace',
  'open_home',
  'search',
  'apply_filters',
  'scroll_collect',
  'scrape_results',
  'open_result',
  'open_target',
  'scrape_profile',
  'follow',
  'connect',
  'connect_swn',
  'connect_sn',
  'open_message',
  'draft_message',
  'send_message',
  'message_batch',
  'follow_user',
  'follow_search',
  'engage_post',
  'engage_batch',
  'follow_batch',
  'compose_post',
  'publish_post',
  'review_queue',
  'continue_outreach',
  'extract_context',
  'export_artifact',
  'open_status',
  'post_status',
  'change_profile_photo',
  'delete_chat',
  'block_user',
  'report_user',
  'map_contacts',
  'generate_image',
  // Engagement
  'like_post',
  'comment_post',
  // Gmail
  'get_context',
  'get_profile_context',
  'reply_to_email',
  // Image pipeline
  'download_image',
  'send_image_dm',
  'generate_and_post',
  'generate_and_dm',
  'upload_to_ai',
  'upload_file',
];

const socialCoreActions = [
  'open_workspace',
  'open_home',
  'search',
  'apply_filters',
  'scroll_collect',
  'scrape_results',
  'open_result',
  'open_target',
  'scrape_profile',
  'draft_message',
  'send_message',
  'message_batch',
  'follow_user',
  'engage_post',
  'engage_batch',
  'follow_batch',
  'compose_post',
  'publish_post',
  'review_queue',
  'continue_outreach',
  'extract_context',
  'export_artifact',
  'like_post',
  'comment_post',
  // Image pipeline — available on all social platforms
  'download_image',
  'send_image_dm',
  'auto_post',
];

export const PLATFORM_SKILL_CAPABILITIES = {
  instagram: [...socialCoreActions, 'scrape_followers', 'map_contacts'],
  twitter: socialCoreActions,
  linkedin: [...socialCoreActions, 'connect', 'connect_swn', 'connect_sn', 'connect_user', 'connect_with_note', 'map_contacts'],
  facebook: [...socialCoreActions, 'follow_search'],
  gmail: [
    'open_workspace',
    'search',
    'scroll_collect',
    'scrape_results',
    'open_target',
    'draft_message',
    'send_message',
    'message_batch',
    'review_queue',
    'continue_outreach',
    'extract_context',
    'export_artifact',
    'get_context',
    'get_profile_context',
    'reply_to_email',
  ],
  whatsapp: [
    'open_workspace',
    'search',
    'open_target',
    'draft_message',
    'send_message',
    'message_batch',
    'review_queue',
    'continue_outreach',
    'open_status',
    'post_status',
    'change_profile_photo',
    'delete_chat',
    'block_user',
    'report_user',
    'map_contacts',
  ],
  research: ['search', 'open_result', 'scroll_collect', 'scrape_results', 'extract_context', 'export_artifact'],
  chatgpt: ['open_workspace', 'chat', 'ask', 'generate_image', 'upload_file', 'upload_to_ai', 'generate_and_post', 'generate_and_dm'],
  gemini:  ['open_workspace', 'chat', 'ask', 'generate_image', 'upload_file', 'upload_to_ai', 'generate_and_post', 'generate_and_dm'],
  sheets:  ['open_workspace', 'create_sheet', 'write_data', 'export_to_sheet', 'read_sheet'],
};

export const WORKFLOW_TEMPLATES = {
  open_workspace: ['open_workspace'],
  generate_image: ['open_workspace', 'generate_image'],
  chat:           ['open_workspace', 'chat'],
  ask:            ['open_workspace', 'ask'],
  upload_file:    ['open_workspace', 'upload_file'],
  create_sheet:   ['open_workspace', 'create_sheet'],
  write_data:     ['open_workspace', 'write_data'],
  export_to_sheet:['open_workspace', 'export_to_sheet'],
  read_sheet:     ['open_workspace', 'read_sheet'],
  find_leads: ['open_workspace', 'open_home', 'search', 'apply_filters', 'scroll_collect', 'scrape_results', 'export_artifact'],
  scrape_profiles: ['open_workspace', 'open_home', 'search', 'apply_filters', 'scroll_collect', 'scrape_results', 'export_artifact'],
  execute_deep_scrape: ['open_workspace', 'open_home', 'search', 'apply_filters', 'scroll_collect', 'scrape_results', 'open_result', 'scrape_profile', 'extract_context', 'export_artifact'],
  scrape_followers: ['open_workspace', 'open_target', 'scroll_collect', 'scrape_results', 'export_artifact'],
  send_message: ['open_workspace', 'open_target', 'send_message'],
  auto_dm: ['open_workspace', 'open_target', 'send_message'],
  message_batch: ['open_workspace', 'message_batch'],
  bulk_dm_csv: ['open_workspace', 'message_batch'],
  follow_user: ['open_workspace', 'open_target', 'follow_user'],
  follow_search: ['open_workspace', 'follow_search'],
  connect: ['open_workspace', 'open_target', 'connect'],
  connect_swn: ['open_workspace', 'open_target', 'connect_swn'],
  connect_sn: ['open_workspace', 'open_target', 'connect_sn'],
  follow_and_message: ['open_workspace', 'open_target', 'follow_user', 'send_message'],
  lead_and_message: ['open_workspace', 'open_home', 'search', 'apply_filters', 'scroll_collect', 'scrape_results', 'export_artifact', 'message_batch'],
  scrape_and_message: ['open_workspace', 'open_home', 'search', 'apply_filters', 'scroll_collect', 'scrape_results', 'export_artifact', 'message_batch'],
  like_ai_comment: ['open_workspace', 'open_target', 'engage_post'],
  like_post:        ['open_workspace', 'open_target', 'like_post'],
  auto_comment:     ['open_workspace', 'open_target', 'comment_post'],
  bulk_engage_csv: ['open_workspace', 'engage_batch'],
  bulk_follow_csv: ['open_workspace', 'follow_batch'],
  auto_post: ['open_workspace', 'compose_post', 'publish_post'],
  run_campaign: ['open_workspace', 'review_queue', 'continue_outreach'],
  research: ['search', 'open_result', 'scroll_collect', 'scrape_results', 'extract_context', 'export_artifact'],
  open_status: ['open_workspace', 'open_status'],
  post_status: ['open_workspace', 'post_status'],
  change_profile_photo: ['open_workspace', 'change_profile_photo'],
  delete_chat: ['open_workspace', 'open_target', 'delete_chat'],
  block_user: ['open_workspace', 'open_target', 'block_user'],
  report_user: ['open_workspace', 'open_target', 'report_user'],
  // Image pipeline
  download_image: ['open_workspace', 'open_target', 'download_image'],
  send_image_dm: ['open_workspace', 'open_target', 'send_message'],
  generate_and_post: ['open_workspace', 'generate_image', 'compose_post', 'publish_post'],
  generate_and_dm: ['open_workspace', 'generate_image', 'open_target', 'send_message'],
  upload_to_ai: ['open_workspace', 'upload_file', 'ask'],
  gmail_search: ['open_workspace', 'search'],
  gmail_get_context: ['open_workspace', 'get_context'],
  gmail_get_profile: ['open_workspace', 'get_profile_context'],
  gmail_reply: ['open_workspace', 'open_target', 'reply_to_email'],
};

export const WORKFLOW_PRESETS = [
  {
    id: 'find_leads',
    label: 'Find leads',
    description: 'Search like a user, scroll results, collect visible profiles, and export an artifact.',
  },
  {
    id: 'scrape_profiles',
    label: 'Scrape profiles',
    description: 'Open search, collect visible people or profile cards, and save context.',
  },
  {
    id: 'follow_user',
    label: 'Follow target',
    description: 'Open a profile and trigger the platform follow/connect action.',
  },
  {
    id: 'follow_search',
    label: 'Follow search results',
    description: 'Search visible people results and follow or add them one by one.',
  },
  {
    id: 'send_message',
    label: 'DM target',
    description: 'Open a target, draft a contextual message, and send or leave it for review.',
  },
  {
    id: 'follow_and_message',
    label: 'Follow + DM',
    description: 'Open a target, follow/connect, draft a message, then send or leave for review.',
  },
  {
    id: 'lead_and_message',
    label: 'Leads + DMs',
    description: 'Find leads, export the scrape, then process provided usernames one by one.',
  },
];

export const TaskContextSchema = z.object({
  platform: PlatformIdSchema.optional(),
  operation: z.enum(TASK_OPERATIONS).optional(),
  query: z.string().optional(),
  username: z.string().optional(),
  usernames: z.array(z.string()).default([]),
  messageGoal: z.string().optional(),
  tone: z.string().optional(),
  attachmentPath: z.string().optional(),
  maxResults: z.number().int().positive().max(500).optional(),
  // destination accepts enum values + any platform name (for image pipelines like generate_and_post)
  destination: z.string().optional(),
  requireManualReview: z.boolean().optional(),
  // Image pipeline extras
  imageSubject: z.string().optional(),
  emailSubject: z.string().optional(),
  emailCc: z.string().optional(),
  emailBcc: z.string().optional(),
  emailSignature: z.string().optional(),
}).default({});

export const TaskRequestSchema = z.object({
  prompt: z.string().min(1),
  context: TaskContextSchema.optional().default({}),
  preferredBrowserMode: z.enum(['attached', 'managed', 'auto']).optional().default('auto'),
});

export const PairingCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});

export const AgentClaimSchema = z.object({
  code: z.string(),
  deviceName: z.string(),
  os: z.enum(['macos', 'windows', 'linux']),
  agentVersion: z.string(),
});

export const AgentTaskEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.created'), taskId: z.string(), prompt: z.string() }),
  z.object({
    type: z.literal('agent.status'),
    online: z.boolean(),
    browserAttached: z.boolean().optional(),
    connectionError: z.string().optional(),
    profileDirectory: z.string().optional(),
    tabs: z.number().int().nonnegative().optional(),
    mode: z.enum(['cdp', 'extension_bridge']).optional(),
    extensionLoaded: z.boolean().optional(),
    platform: z.string().optional(),
  }),
  z.object({ type: z.literal('plan.generated'), plan: ExecutionPlanSchema }),
  z.object({ type: z.literal('step.started'), stepId: z.string(), label: z.string() }),
  z.object({ type: z.literal('step.progress'), stepId: z.string(), message: z.string(), current: z.number().optional(), total: z.number().optional() }),
  z.object({ type: z.literal('step.failed'), stepId: z.string(), error: z.string(), retrying: z.boolean().optional() }),
  z.object({ type: z.literal('artifact.ready'), artifactId: z.string(), kind: z.enum(['csv', 'json', 'text', 'screenshot']), url: z.string().optional() }),
  z.object({ type: z.literal('task.completed'), summary: z.string() }),
  z.object({ type: z.literal('task.failed'), error: z.string() }),
  z.object({ type: z.literal('campaign.updated'), campaignId: z.string(), status: z.string() }),
]);

export function createId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function safeParse(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(message || 'Invalid payload');
  }
  return parsed.data;
}
