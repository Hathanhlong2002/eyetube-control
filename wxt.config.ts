import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'EyeTube Control',
    description: 'Control YouTube with deliberate eye gestures processed locally.',
    minimum_chrome_version: '116',
    permissions: ['offscreen', 'storage', 'activeTab'],
    host_permissions: ['*://*.youtube.com/*'],
    action: {
      default_title: 'Start or stop EyeTube Control',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
