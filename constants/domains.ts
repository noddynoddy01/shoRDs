export type ResearchDomain = {
  id: string;
  name: string;
  icon: string;
  description: string;
};

export type FeedCategory = 
  | "popular" 
  | "trending" 
  | "latest" 
  | "most_cited" 
  | "open_access" 
  | "review_papers" 
  | "survey_papers";

export const RESEARCH_DOMAINS: ResearchDomain[] = [
  { id: "ai", name: "Artificial Intelligence", icon: "hardware-chip-outline", description: "Foundational AI algorithms and multi-modal models" },
  { id: "ml", name: "Machine Learning", icon: "git-network-outline", description: "Supervised, unsupervised, and reinforcement learning" },
  { id: "cv", name: "Computer Vision", icon: "eye-outline", description: "Object detection, segmentation, and generative vision" },
  { id: "nlp", name: "Natural Language Processing", icon: "text-outline", description: "LLMs, translation, and syntactic parsing" },
  { id: "robotics", name: "Robotics", icon: "construct-outline", description: "Autonomous navigation, kinematics, and manipulation" },
  { id: "cybersecurity", name: "Cyber Security", icon: "shield-checkmark-outline", description: "Cryptography, network defense, and vulnerability discovery" },
  { id: "quantum", name: "Quantum Computing", icon: "planet-outline", description: "Qubit architectures, error correction, and quantum algorithms" },
  { id: "electronics", name: "Electronics", icon: "flash-outline", description: "Analog/digital circuits and signal processing" },
  { id: "semiconductors", name: "Semiconductors", icon: "layers-outline", description: "Microchip fabrication, lithography, and VLSI design" },
  { id: "embedded", name: "Embedded Systems", icon: "cpu-outline", description: "Microcontrollers, RTOS, and edge compute" },
  { id: "electrical", name: "Electrical Engineering", icon: "power-outline", description: "Power grids, transformers, and high-voltage systems" },
  { id: "mechanical", name: "Mechanical Engineering", icon: "cog-outline", description: "Thermodynamics, fluid mechanics, and CAD design" },
  { id: "civil", name: "Civil Engineering", icon: "business-outline", description: "Structural integrity, materials, and urban design" },
  { id: "chemical", name: "Chemical Engineering", icon: "beaker-outline", description: "Process synthesis, catalysis, and reaction kinetics" },
  { id: "physics", name: "Physics", icon: "atom-outline", description: "Astrophysics, quantum mechanics, and particle physics" },
  { id: "mathematics", name: "Mathematics", icon: "calculator-outline", description: "Topology, number theory, and applied analysis" },
  { id: "biology", name: "Biology", icon: "leaf-outline", description: "Cellular biology, ecology, and evolutionary science" },
  { id: "medicine", name: "Medicine", icon: "medical-outline", description: "Clinical trials, pathology, and therapeutic interventions" },
  { id: "healthcare", name: "Healthcare", icon: "heart-outline", description: "Health informatics, public health, and diagnostics" },
  { id: "genetics", name: "Genetics", icon: "dna-outline", description: "CRISPR, gene sequencing, and genomics" },
  { id: "climate", name: "Climate Science", icon: "cloudy-outline", description: "Meteorology, global warming models, and oceanography" },
  { id: "astronomy", name: "Astronomy", icon: "telescope-outline", description: "Exoplanets, cosmology, and space exploration" },
  { id: "materials", name: "Materials Science", icon: "cube-outline", description: "Nanomaterials, polymers, and superconductors" },
  { id: "economics", name: "Economics", icon: "trending-up-outline", description: "Macroeconomics, econometrics, and game theory" },
  { id: "finance", name: "Finance", icon: "cash-outline", description: "Quantitative finance, portfolio optimization, and Fintech" },
  { id: "business", name: "Business", icon: "briefcase-outline", description: "Management, supply chain, and organizational behavior" },
  { id: "psychology", name: "Psychology", icon: "person-outline", description: "Cognitive science, behavioral analysis, and neuroscience" },
  { id: "education", name: "Education", icon: "school-outline", description: "Pedagogy, ed-tech, and learning analytics" },
  { id: "social_sciences", name: "Social Sciences", icon: "people-outline", description: "Sociology, anthropology, and political science" }
];

export const FEED_CATEGORIES: { id: FeedCategory; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "trending", label: "Trending" },
  { id: "latest", label: "Newest" },
  { id: "most_cited", label: "Most Cited" },
  { id: "open_access", label: "Open Access" },
  { id: "review_papers", label: "Review Papers" },
  { id: "survey_papers", label: "Survey Papers" }
];
