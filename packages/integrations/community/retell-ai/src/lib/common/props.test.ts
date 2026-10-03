import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import {
  AppConnectionType,
  ConnectionValueForAuthProperty,
  PropertyContext,
} from '@inboxfm-connect/pieces-framework';
import { agentIdDropdown } from './props';
import { retellAiAuth } from './auth';
import * as clientModule from './client';

describe('agentIdDropdown (Issue #477)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const authValue: ConnectionValueForAuthProperty<typeof retellAiAuth> = {
    type: AppConnectionType.CUSTOM_AUTH,
    props: {
      apiKey: 'test_retell_key',
    },
  };

  const mockContext: PropertyContext = {
    server: {
      apiUrl: 'http://localhost:3000',
      publicUrl: 'http://localhost:3000',
      token: 'test_token',
    },
    project: {
      id: 'proj_123',
      externalId: async (): Promise<string | undefined> => undefined,
    },
    flows: {
      list: async () => ({ data: [], next: null, previous: null }),
      current: {
        id: 'flow_1',
        version: { id: 'ver_1' },
      },
    },
    connections: {
      get: async () => null,
    },
  };

  it('calls POST /v2/list-agents?limit=100 with channel filter and parses envelope', async () => {
    const apiSpy = vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({
      items: [
        {
          agent_id: 'agent_123',
          agent_name: 'Customer Support Bot',
          version: 1,
          is_published: true,
          voice_id: 'voice_1',
        },
      ],
      has_more: false,
    });

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: authValue }, mockContext);

    expect(apiSpy).toHaveBeenCalledWith({
      auth: authValue,
      method: HttpMethod.POST,
      url: '/v2/list-agents?limit=100',
      body: {
        filter_criteria: {
          channel: {
            type: 'string',
            op: 'eq',
            value: 'voice',
          },
        },
      },
    });

    expect(result).toEqual({
      disabled: false,
      options: [
        {
          label: 'Customer Support Bot (agent_123)',
          value: 'agent_123',
        },
      ],
    });
  });

  it('handles unnamed agent with fallback label', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({
      items: [
        {
          agent_id: 'agent_456',
          agent_name: '',
          version: 1,
          is_published: true,
          voice_id: 'voice_2',
        },
      ],
    });

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: authValue }, mockContext);

    expect(result).toEqual({
      disabled: false,
      options: [
        {
          label: 'Unnamed Agent (agent_456)',
          value: 'agent_456',
        },
      ],
    });
  });

  it('returns placeholder when no agents found in workspace', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({ items: [] });

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: authValue }, mockContext);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'No agents found in your workspace.',
    });
  });

  it('returns placeholder when auth is missing', async () => {
    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: undefined }, mockContext);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'Connect your Retell AI account first',
    });
  });

  it('handles API errors gracefully with descriptive placeholder', async () => {
    vi.spyOn(clientModule, 'retellAiApiCall').mockRejectedValue(new Error('Network error'));

    const dropdown = agentIdDropdown('Agent');
    const result = await dropdown.options({ auth: authValue }, mockContext);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'Error loading agents: Network error',
    });
  });
});

describe('callIdDropdown — POST /v3/list-calls migration (Issue #477)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const authValue: ConnectionValueForAuthProperty<typeof retellAiAuth> = {
    type: AppConnectionType.CUSTOM_AUTH,
    props: { apiKey: 'test_retell_key' },
  };

  const mockContext: PropertyContext = {
    server: {
      apiUrl: 'http://localhost:3000',
      publicUrl: 'http://localhost:3000',
      token: 'test_token',
    },
    project: {
      id: 'proj_123',
      externalId: async (): Promise<string | undefined> => undefined,
    },
    flows: {
      list: async () => ({ data: [], next: null, previous: null }),
      current: { id: 'flow_1', version: { id: 'ver_1' } },
    },
    connections: { get: async () => null },
  };

  it('calls POST /v3/list-calls and reads from items envelope', async () => {
    const { callIdDropdown } = await import('./props');
    const apiSpy = vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({
      items: [
        {
          call_id: 'call_abc',
          agent_id: 'agent_1',
          call_status: 'ended',
          call_type: 'web_call',
        },
      ],
      has_more: false,
    });

    const result = await callIdDropdown.options({ auth: authValue }, mockContext);

    expect(apiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: HttpMethod.POST,
        url: '/v3/list-calls',
      })
    );
    expect(result).toEqual({
      disabled: false,
      options: [{ label: 'call_abc (ended - web_call)', value: 'call_abc' }],
    });
  });

  it('returns placeholder when no calls returned', async () => {
    const { callIdDropdown } = await import('./props');
    vi.spyOn(clientModule, 'retellAiApiCall').mockResolvedValue({ items: [] });

    const result = await callIdDropdown.options({ auth: authValue }, mockContext);

    expect(result).toEqual({
      disabled: true,
      options: [],
      placeholder: 'No calls found in your workspace.',
    });
  });
});
