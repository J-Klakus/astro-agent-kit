import type { GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { createMarkdownEndpoint } from "astro-agent-kit/markdown";

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection("blog");
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
};

export const GET = createMarkdownEndpoint({
  map: (props: {
    post: {
      id: string;
      body?: string;
      data: Record<string, unknown>;
    };
  }) => ({
    frontmatter: {
      title: props.post.data.title as string,
      canonical: `https://example.com/blog/${props.post.id}/`,
      description: props.post.data.description as string,
      pubDate: props.post.data.pubDate as string | Date,
      tags: props.post.data.tags as string[],
    },
    body: props.post.body ?? "",
  }),
});
