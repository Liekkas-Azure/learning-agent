export type VaultEntryDto = {
  id: string;
  kind: "link" | "note" | "clip";
  title: string;
  url: string | null;
  body: string | null;
  origin: string | null;
  createdAt: string;
  updatedAt: string;
  tags: { id: string; name: string }[];
};

export type VaultTagDto = { id: string; name: string; count: number };

export type VaultGraphNode = {
  id: string;
  label: string;
  kind: "entry" | "tag";
  entryKind?: string;
};

export type VaultGraphEdge = { source: string; target: string };

export type FeedItemDto = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string;
  summary: string | null;
};

export type IngestDraftDto = {
  title: string;
  origin: string | null;
  content: string;
  summary: string;
  suggestedTags: string[];
};

export type VaultSubscriptionDto = {
  id: string;
  type: "RSS" | "SEED_URL" | "SEARCH_QUERY";
  config: { url?: string; label?: string | null };
  refreshCron: string | null;
  lastFetchedAt: string | null;
};

export type SemanticResultDto = {
  score: number;
  snippet: string;
  document: {
    id: string;
    title: string | null;
    canonicalUrl: string;
    url: string;
    domain: string | null;
    fetchedAt: string;
  };
};

export type LearningPathStageDto = {
  id: string;
  name: string;
  goal: string;
  prerequisites: string[];
  tasks: string[];
  reviewPlan: string;
};
