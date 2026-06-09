export type Domain =
  | "AI / ML"
  | "Robotics"
  | "Electronics"
  | "Biotechnology"
  | "Quantum Computing"
  | "Space Tech"
  | "Cybersecurity"
  | "Renewable Energy"
  | "Nanotechnology"
  | "Genetics"
  | "Material Science"
  | "Climate Tech"
  | "Blockchain & Web3"
  | "Neuroscience"
  | "Nuclear Fusion"
  | "Medical Devices"
  | "IoT & Edge Computing";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  bio: string;
  interests: string[];
  profileImage: string;
  role?: "admin" | "user" | "mentor";
  phoneNumber?: string;
  country?: string;
  language?: string;
  subscription?: {
    tier: "free" | "premium";
    expiresAt: string;
    currency: "USD" | "INR";
  };
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
  pdfUri?: string;
  organization?: string;
  pubYear?: number;
  doi?: string;
  illustrations?: string[];
  insights?: string[];
  audioUrl?: string;
  videoUrl?: string;
  translations?: Record<
    string,
    {
      title: string;
      summary: string;
      fullExplanation: string;
    }
  >;
};

export type Message = {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
};

export type ChatSession = {
  id: string;
  participants: string[]; // [user1, user2]
  participantNames: string[];
  lastMessageText: string;
  lastMessageTimestamp: number;
  unreadCount: number;
};
