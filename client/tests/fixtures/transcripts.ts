import type { RawConversation } from '../../src/capture/types';

export const transcripts: RawConversation[] = [
  {
    id: 'c1', title: 'Refactor plan', createdAt: '2026-01-10T09:00:00Z',
    messages: [
      { role: 'user', text: 'Should I split this 2000-line file? List the seams first.', createdAt: '2026-01-10T09:00:00Z' },
      { role: 'assistant', text: 'Yes. The seams are X, Y, Z.', createdAt: '2026-01-10T09:01:00Z' },
    ],
  },
  {
    id: 'c2', title: 'Debugging flaky test', createdAt: '2026-05-20T14:00:00Z',
    messages: [
      { role: 'user', text: 'Test fails 1 in 10. I bet it is a timing race. Verify before fixing.', createdAt: '2026-05-20T14:00:00Z' },
      { role: 'assistant', text: 'It is a race on the shared cache.', createdAt: '2026-05-20T14:02:00Z' },
    ],
  },
];
