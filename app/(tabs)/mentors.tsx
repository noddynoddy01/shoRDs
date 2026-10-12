import { FeatureUnavailable } from "@/components/FeatureUnavailable";

/**
 * Mentor directory, author questions and collaboration are not built (no backend, no real mentors, no notification path).
 * An earlier version listed sample people and said an enquiry had been "sent to the author"; nothing was ever sent.
 */
export default function MentorsScreen() {
  return (
    <FeatureUnavailable
      title="Mentors"
      description="Finding mentors and sending questions to paper authors is planned. There is no mentor directory or messaging service yet, so nothing can be sent from here."
    />
  );
}
