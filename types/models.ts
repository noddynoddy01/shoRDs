export type Domain =
  | "AI / ML"
  | "Robotics"
  | "Electronics"
  | "Biotechnology"
  | "Quantum Computing"
  | "Space Tech"
  | "Cybersecurity"
  | "Renewable Energy";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  bio: string;
  interests: string[];
  profileImage: string;
};

export type Mentor = {
  id: string;
  name: string;
  title: string;
  focus: string;
  affiliation: string;
  bio: string;
  availability: string;
};

export type Paper = {
  id: string;
  title: string;
  domain: Domain;
  summary: string;
  fullExplanation: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  originalLink: string;
  tags: string[];
  readingTime: string;
  savedCount: number;
  createdAt: Date;
};
