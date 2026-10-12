import { FeatureUnavailable } from "@/components/FeatureUnavailable";

export default function ResearchReviewScreen() {
  return (
    <FeatureUnavailable
      title="Research Review Mode"
      description="Literature review across many papers, with evidence composition and contradictions between studies, is planned. It needs a backend that retrieves and reads the papers, which does not exist yet."
    />
  );
}
