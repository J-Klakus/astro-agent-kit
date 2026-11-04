import { defineConfig } from "astro/config";
import agentDiscovery from "astro-agent-kit";

export default defineConfig({
  site: "https://example.com",
  integrations: [
    agentDiscovery({
      llmsTxt: {
        title: "Fixture Site",
        summary: "A fixture for astro-agent-kit.",
      },
      indexnow: { key: "testkey1234567890" },
      markdownAlternate: true,
    }),
  ],
});
