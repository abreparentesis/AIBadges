import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AI Fluency Index',
    // No 'tabs' permission: every tabs.query is URL-filtered to origins already granted via
    // host_permissions, which is enough for those tabs' ids/urls to appear in query results.
    permissions: ['storage', 'scripting', 'alarms'],
    host_permissions: [
      'https://claude.ai/*',
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://aibadges-api.mindmaterial.io/*',
    ],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png' },
    },
  },
});
