import { buildSearchUrl, openAttachedPage, pageSnapshot, scrapeGoogleResults, summarizeAction } from '../common.js';

export const researchHandler = {
  platform: 'research',
  async execute({ step, managedBrowser, attachedBrowser }) {
    const query = step.args.query || step.args.prompt || 'lead generation';
    const engine = step.args.engine || 'google';

    if (step.action === 'search' || step.action === 'open_result') {
      const results = await managedBrowser.scrapePages({
        profileId: 'research',
        urls: [buildSearchUrl(query, engine)],
      });
      return {
        status: 'completed',
        summary: summarizeAction('research', step),
        data: results,
      };
    }

    if (step.action === 'extract_context' || step.action === 'export_artifact' || step.action === 'scrape_results') {
      const { page, results } = await scrapeGoogleResults(attachedBrowser, {
        query,
        platform: 'research',
        maxResults: step.args.maxResults,
      });
      return {
        status: 'completed',
        summary: summarizeAction('research', step),
        data: { page: await pageSnapshot(page), results },
      };
    }

    const page = await openAttachedPage(attachedBrowser, buildSearchUrl(query, engine), { forceNavigate: true });
    return {
      status: 'ready',
      summary: summarizeAction('research', step),
      data: await pageSnapshot(page),
    };
  },
};
