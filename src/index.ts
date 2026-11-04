import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { runBuild } from "./build.js";
import { needsSite, resolveOptions } from "./options.js";
import { resolveOutputDir } from "./scan.js";
import type { AgentKitOptions } from "./types.js";

/**
 * Zero-config agent discovery for Astro.
 *
 * Generates `llms.txt`, aggregate schema feeds, a schemamap, IndexNow assets,
 * and markdown-alternate discovery links from the built HTML.
 */
export default function agentDiscovery(
  options: AgentKitOptions = {},
): AstroIntegration {
  let resolved = resolveOptions(options);

  return {
    name: "astro-agent-kit",
    hooks: {
      "astro:config:setup": ({ config, logger }) => {
        resolved = {
          ...resolveOptions({
            ...options,
            site: options.site ?? config.site ?? undefined,
          }),
          root: fileURLToPath(config.root),
          output: config.output,
        };

        if (needsSite(resolved) && !resolved.site) {
          throw new Error(
            "[astro-agent-kit] `site` is required: set `site` in astro.config or pass the `site` option",
          );
        }

        if (options.indexnow && !resolved.indexnow) {
          logger.warn(
            "IndexNow is enabled but no key was provided; set INDEXNOW_KEY or remove the `indexnow` option",
          );
        }
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (resolved.output !== "static") {
          logger.warn(
            `agent surfaces are generated for static builds; skipping (output: ${resolved.output})`,
          );
          return;
        }

        const outputDir = await resolveOutputDir(dir);
        if (!outputDir) {
          logger.warn("could not find built HTML; skipping agent surfaces");
          return;
        }

        await runBuild(resolved, outputDir, logger);
      },
    },
  };
}

export { createMarkdownEndpoint, renderMarkdownAlternate } from "./markdown.js";
export type {
  CreateMarkdownEndpointOptions,
  MarkdownAlternateInput,
  MarkdownFrontmatter,
  RenderedMarkdown,
  RenderMarkdownOptions,
} from "./markdown.js";
export { submitIndexNow } from "./indexnow.js";
export type {
  IndexNowManifest,
  IndexNowUrl,
  SubmitIndexNowOptions,
  SubmitIndexNowResult,
} from "./indexnow.js";
export type {
  AgentKitOptions,
  IndexNowOptions,
  LlmsTxtOptions,
  MarkdownAlternateOptions,
  RobotsOptions,
  SchemaOptions,
  SchemamapOptions,
} from "./types.js";
