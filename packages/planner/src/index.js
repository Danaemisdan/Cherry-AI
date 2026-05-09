import {
  ExecutionPlanSchema,
  PLATFORM_SKILL_CAPABILITIES,
  WORKFLOW_TEMPLATES,
  createId,
} from '@cherry/shared';

const PLATFORM_HINTS = {
  instagram: ['instagram', 'ig', 'dm', 'reel', 'comment'],
  twitter: ['twitter', 'x ', 'tweet', 'tweets', 'mention'],
  linkedin: ['linkedin', 'founders', 'prospects', 'connect'],
  facebook: ['facebook', 'fb', 'page', 'group'],
  gmail: ['gmail', 'email', 'inbox', 'thread', 'reply'],
  whatsapp: ['whatsapp', 'wa', 'chat'],
  chatgpt: ['chatgpt', 'gpt', 'openai', 'dalle', 'ask chatgpt', 'generate with chatgpt'],
  gemini: ['gemini', 'google ai', 'imagen', 'ask gemini', 'generate with gemini'],
  sheets: ['google sheets', 'spreadsheet', 'excel', 'google sheet', 'make a sheet', 'create a sheet', 'export to sheet'],
  research: ['lead', 'research', 'scrape', 'website', 'duckduckgo', 'google', 'search'],
};


function detectPlatforms(prompt, context = {}) {
  if (context.platform) return [context.platform];
  const lower = prompt.toLowerCase();
  const detected = Object.entries(PLATFORM_HINTS)
    .filter(([, hints]) => hints.some((hint) => lower.includes(hint)))
    .map(([platform]) => platform);

  return detected.length ? detected : ['research'];
}

function detectOperation(prompt, context = {}) {
  if (context.operation) return context.operation;

  const lower = prompt.toLowerCase();
  
  // Specific DM methods injected by UI
  if (lower.includes('automated dm to contact')) return 'auto_dm_contact';
  if (lower.includes('automated dm to new person')) return 'auto_dm_new';
  if (lower.includes('automated dm')) return 'auto_dm';

  const wantsLeads = /lead|scrape|search|find|prospect|list/i.test(lower);
  const wantsMessaging = /message|dm|reply|outreach|follow.?up|contact|reach out/i.test(lower);
  const wantsCampaign = /campaign|always-on|always on|monitor inbox|continue outreach/i.test(lower);
  const wantsImage = /image|generate image|draw|picture|photo|dalle|imagen/i.test(lower);
  const wantsSheet = /spreadsheet|excel|google sheet|make a sheet|create a sheet|export to sheet/i.test(lower);
  const wantsChat = /ask|chat|prompt|generate text|write|summarize|translate/i.test(lower);
  const wantsUpload = /upload|reference image|reference asset|use this file|attach/i.test(lower);
  const wantsExport = /export|save to sheet|put in sheet|add to spreadsheet/i.test(lower);

  if (wantsSheet && wantsExport) return 'export_to_sheet';
  if (wantsSheet) return 'create_sheet';
  if (wantsUpload && wantsImage) return 'generate_image'; // reference image generation
  if (wantsUpload) return 'upload_file';
  if (wantsImage) return 'generate_image';
  if (wantsCampaign) return 'run_campaign';
  if (wantsLeads && wantsMessaging) return 'lead_and_message';
  if (wantsMessaging) return context.usernames?.length > 1 ? 'message_batch' : 'send_message';
  if (wantsLeads) return 'find_leads';
  if (wantsChat) return 'chat';
  return 'research';
}


function browserModeFor(platform) {
  if (platform === 'research') return 'managed';
  return 'attached';
}

function actionsFor(platform, prompt, context = {}) {
  const operation = detectOperation(prompt, context);
  if (platform === 'research' && operation === 'open_workspace') {
    return ['search', 'open_result'];
  }

  const template = WORKFLOW_TEMPLATES[operation];
  if (template) {
    const supportedTemplate = template.filter((action) => platformSupportsAction(platform, action));
    return supportedTemplate.length ? supportedTemplate : ['open_workspace'].filter((action) => platformSupportsAction(platform, action));
  }

  if (platform === 'research') {
    return WORKFLOW_TEMPLATES.research.filter((action) => platformSupportsAction(platform, action));
  }

  if (operation === 'open_workspace') return ['open_workspace'];
  if (operation === 'send_message') return ['open_workspace', 'open_target', 'draft_message', 'send_message'];
  if (operation === 'auto_dm') return ['open_workspace', 'open_target', 'draft_message', 'send_message'];
  if (operation === 'auto_dm_contact') return ['open_workspace', 'open_target', 'draft_message', 'send_message'];
  if (operation === 'auto_dm_new') return ['open_workspace', 'open_target', 'draft_message', 'send_message'];
  if (operation === 'message_batch') return ['open_workspace', 'message_batch'];
  if (operation === 'bulk_dm_csv') return ['open_workspace', 'message_batch'];
  if (operation === 'find_leads') return ['open_workspace', 'search', 'scrape_results', 'export_artifact'];
  if (operation === 'scrape_profiles') return ['open_workspace', 'search', 'scrape_results', 'export_artifact'];
  if (operation === 'execute_deep_scrape') return ['open_workspace', 'search', 'scrape_results', 'extract_context', 'export_artifact'];
  if (operation === 'scrape_followers') return ['open_workspace', 'open_target', 'scrape_results', 'export_artifact'];
  if (operation === 'lead_and_message') return ['open_workspace', 'search', 'scrape_results', 'export_artifact', 'message_batch'];
  if (operation === 'run_campaign') return ['open_workspace', 'review_queue', 'continue_outreach'];
  if (operation === 'like_ai_comment') return ['open_workspace', 'open_target', 'engage_post'];
  if (operation === 'follow_user') return ['open_workspace', 'open_target', 'follow_user'];
  if (operation === 'auto_post') return ['open_workspace', 'compose_post', 'publish_post'];
  if (operation === 'bulk_engage_csv') return ['open_workspace', 'engage_batch'];
  if (operation === 'bulk_follow_csv') return ['open_workspace', 'follow_batch'];
  if (operation === 'open_status') return ['open_workspace', 'open_status'];
  if (operation === 'post_status') return ['open_workspace', 'post_status'];
  if (operation === 'change_profile_photo') return ['open_workspace', 'change_profile_photo'];
  if (operation === 'delete_chat') return ['open_workspace', 'open_target', 'delete_chat'];
  if (operation === 'block_user') return ['open_workspace', 'open_target', 'block_user'];
  if (operation === 'report_user') return ['open_workspace', 'open_target', 'report_user'];

  const actions = [];
  if (/reply|respond/i.test(prompt)) actions.push('reply');
  if (/dm|message|outreach|follow.?up/i.test(prompt)) actions.push('send_message');
  if (/comment/i.test(prompt)) actions.push('comment');
  if (/follow|connect/i.test(prompt)) actions.push('follow');
  if (/post|publish/i.test(prompt)) actions.push('post');
  if (/scrape|lead|search|find/i.test(prompt)) actions.push('search', 'scrape_results');
  if (!actions.length) actions.push('open_workspace', 'extract_context');
  return [...new Set(actions)].filter((action) => platformSupportsAction(platform, action));
}

function platformSupportsAction(platform, action) {
  const supported = PLATFORM_SKILL_CAPABILITIES[platform] || [];
  if (supported.includes(action)) return true;
  if (action === 'scrape_followers') return supported.includes('scrape_results');
  return false;
}

function buildArgs({ prompt, platform, action, context = {} }) {
  const searchLikeActions = new Set(['search', 'scrape_results', 'extract_context', 'export_artifact', 'open_result']);
  return {
    prompt,
    platform,
    query: context.query ?? (searchLikeActions.has(action) ? prompt : undefined),
    username: context.username,
    usernames: context.usernames || [],
    messageGoal: context.messageGoal,
    tone: context.tone,
    attachmentPath: context.attachmentPath,
    operation: context.operation,
    maxResults: context.maxResults,
    destination: context.destination,
    requireManualReview: context.requireManualReview ?? false,
    oneByOne: action === 'message_batch',
  };
}

export function planTask({ taskId = createId('task'), prompt, context = {}, preferredBrowserMode = 'auto' }) {
  const targetPlatforms = detectPlatforms(prompt, context);
  const operation = detectOperation(prompt, context);
  const steps = targetPlatforms.flatMap((platform) =>
    actionsFor(platform, prompt, context).map((action, index) => ({
      id: createId(`${platform}_${index}`),
      platform,
      browserMode: preferredBrowserMode === 'auto' ? browserModeFor(platform) : preferredBrowserMode,
      action,
      args: buildArgs({ prompt, platform, action, context }),
      successCriteria: `Complete ${action} on ${platform}`,
      retryPolicy: {
        maxAttempts: 2,
        replanOnFailure: true,
      },
    })),
  );

  return ExecutionPlanSchema.parse({
    taskId,
    objective: prompt,
    targetPlatforms,
    steps,
  });
}
