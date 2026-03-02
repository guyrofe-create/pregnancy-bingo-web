export type MythAnswer = "myth" | "truth";

export type MythTopic =
  | "pregnancy"
  | "period"
  | "fertility"
  | "contraception"
  | "postpartum"
  | "breastfeeding";

export type EvidenceSourceType = "pubmed" | "guideline";

export type EvidenceArticleType =
  | "systematic_review"
  | "meta_analysis"
  | "guideline"
  | "randomized_trial"
  | "cohort"
  | "case_control"
  | "cross_sectional"
  | "narrative_review";

export type BaseEvidenceSeed = {
  id: string;
  sourceType: EvidenceSourceType;
  articleType: EvidenceArticleType;
  year: number;
  title: string;
  journal?: string;
  abstractQuote?: string;
  notes?: string;
};

export type PubMedEvidenceSeed = BaseEvidenceSeed & {
  sourceType: "pubmed";
  pmid: string;
  pubmedUrl: string;
  journal: string;
  abstractQuote: string;
};

export type GuidelineEvidenceSeed = BaseEvidenceSeed & {
  sourceType: "guideline";
  url: string;
};

export type EvidenceSeed = PubMedEvidenceSeed | GuidelineEvidenceSeed;

export type MythItem = {
  id: string;
  topic: MythTopic;
  statement: string;
  answer: MythAnswer;
  explanation: string;
  evidenceSeedIds: string[];
};
