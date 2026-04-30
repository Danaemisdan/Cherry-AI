import { CampaignSchema, createId } from '@cherry/shared';

export class CampaignEngine {
  constructor({ onEvent }) {
    this.onEvent = onEvent || (() => {});
    this.campaigns = new Map();
    this.timers = new Map();
  }

  upsertCampaign(input) {
    const campaign = CampaignSchema.parse({
      id: input.id || createId('campaign'),
      ...input,
    });

    this.campaigns.set(campaign.id, campaign);
    this.onEvent({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
    return campaign;
  }

  listCampaigns() {
    return [...this.campaigns.values()];
  }

  startCampaign(campaignId, runner) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    this.stopCampaign(campaignId);

    const updated = { ...campaign, status: 'active' };
    this.campaigns.set(campaignId, updated);
    this.onEvent({ type: 'campaign.updated', campaignId, status: 'active' });

    const schedule = updated.schedules[0];
    if (!schedule) return updated;

    const interval = setInterval(() => runner(updated), schedule.cadenceMinutes * 60 * 1000);
    this.timers.set(campaignId, interval);
    return updated;
  }

  pauseCampaign(campaignId) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
    this.stopCampaign(campaignId);
    const updated = { ...campaign, status: 'paused' };
    this.campaigns.set(campaignId, updated);
    this.onEvent({ type: 'campaign.updated', campaignId, status: 'paused' });
    return updated;
  }

  stopCampaign(campaignId) {
    const timer = this.timers.get(campaignId);
    if (timer) clearInterval(timer);
    this.timers.delete(campaignId);
  }
}
