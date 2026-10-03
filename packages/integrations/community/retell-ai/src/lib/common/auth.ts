import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { retellAiApiCall } from './client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { AppConnectionType } from '@inboxfm-connect/pieces-framework';

// For typing purposes in the client
export const RetellAiAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: 'Your Retell AI API Key.',
  required: true,
});

export const retellAiAuth = PieceAuth.CustomAuth({
  description: `
  Please follow these steps to get your Retell AI API key:
  
  1. Log in to your Retell AI dashboard.
  2. Navigate to the API section.
  3. Generate a new API key or copy your existing one.
  4. Use this API key to authenticate your requests.`,
  props: {
    apiKey: RetellAiAuth,
  },
  validate: async ({ auth }) => {
    try {
      // GET /list-chat was deprecated on 06/15/2026 and removed. Use
      // POST /v2/list-agents (limit 1) as the auth-validation probe — it is
      // stable, returns quickly, and a 401 reliably surfaces an invalid key.
      await retellAiApiCall({
        method: HttpMethod.POST,
        url: '/v2/list-agents?limit=1',
        auth: {
          type: AppConnectionType.CUSTOM_AUTH,
          props: auth,
        },
        body: {},
      });
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error: 'Invalid API Key',
      };
    }
  },
  required: true,
});