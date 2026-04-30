import { dialogueEngine, DIALOGUE_STATE } from '@cherry/planner/dialogue';

export function setupDialogueRoutes(app) {
  // Start or continue a dialogue
  app.post('/dialogue', async (req, res) => {
    const { userId = 'default', message, choice } = req.body;

    try {
      let response;

      if (choice) {
        // User made a choice from options
        response = dialogueEngine.handleChoice(userId, choice);
      } else if (message) {
        // New message - parse intent and start dialogue
        response = dialogueEngine.startDialogue(userId, message);
      } else {
        return res.status(400).json({ error: 'Need message or choice' });
      }

      res.json({
        ...response,
        userId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get current dialogue state
  app.get('/dialogue/:userId', (req, res) => {
    const session = dialogueEngine.getSession(req.params.userId);
    res.json({
      state: session.state,
      context: session.context,
      history: session.history.slice(-10),
    });
  });

  // Reset dialogue
  app.delete('/dialogue/:userId', (req, res) => {
    dialogueEngine.reset(req.params.userId);
    res.json({ reset: true });
  });

  // Get available strategies (for UI)
  app.get('/strategies', (req, res) => {
    const strategies = [
      { id: 'sales', name: 'Sales Growth', icon: '💰', description: 'Generate leads and book meetings' },
      { id: 'marketing', name: 'Brand Marketing', icon: '📢', description: 'Grow followers and engagement' },
      { id: 'research', name: 'Market Research', icon: '🔍', description: 'Analyze competitors and trends' },
      { id: 'monitor', name: 'Social Monitor', icon: '👁️', description: 'Auto-respond to messages' },
      { id: 'viral', name: 'Viral Growth', icon: '🚀', description: 'Create viral content' },
    ];
    res.json(strategies);
  });
}
