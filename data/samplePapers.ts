import { Domain, Mentor, Paper, UserProfile } from "@/types/models";

export const domains: Domain[] = [
  "AI / ML",
  "Robotics",
  "Electronics",
  "Quantum Computing",
  "Space Tech",
  "Biotechnology",
  "Cybersecurity",
  "Renewable Energy"
];

export const mentors: Mentor[] = [
  {
    id: "rajeev-shorey",
    name: "Dr. Rajeev Shorey",
    title: "Research Mentor",
    focus: "Networks, intelligent systems, and applied research strategy",
    affiliation: "IIIT Surat Mentor Network",
    bio: "Guides students on turning strong technical ideas into readable, rigorous research directions.",
    availability: "Connect for research framing and publication guidance"
  },
  {
    id: "kaustaubh-dhondhge",
    name: "Dr. Kaustaubh Dhondhge",
    title: "Research Mentor",
    focus: "Computing systems, academic writing, and experimentation",
    affiliation: "IIIT Surat Mentor Network",
    bio: "Supports early-stage researchers with sharper problem statements, evaluation plans, and paper structure.",
    availability: "Connect for paper review and project refinement"
  },
  {
    id: "sudeep-sharma",
    name: "Dr. Sudeep Sharma",
    title: "Research Mentor",
    focus: "Engineering education, innovation, and interdisciplinary projects",
    affiliation: "IIIT Surat Mentor Network",
    bio: "Helps students connect classroom knowledge with practical research that can reach a wider audience.",
    availability: "Connect for interdisciplinary research guidance"
  },
  {
    id: "manish-rai",
    name: "Dr. Manish Rai",
    title: "Research Mentor",
    focus: "AI-enabled systems, software projects, and student innovation",
    affiliation: "IIIT Surat Mentor Network",
    bio: "Mentors student teams on building useful software around research workflows and readable knowledge.",
    availability: "Connect for AI/software research mentoring"
  },
  {
    id: "meera-iyer",
    name: "Dr. Meera Iyer",
    title: "Visiting Mentor",
    focus: "Responsible AI and human-centered summarization",
    affiliation: "shoRDs Research Circle",
    bio: "Advises on making complex scientific language understandable without losing accuracy.",
    availability: "Connect for responsible AI review"
  },
  {
    id: "arjun-sen",
    name: "Prof. Arjun Sen",
    title: "Visiting Mentor",
    focus: "Robotics, prototyping, and lab-to-product translation",
    affiliation: "shoRDs Research Circle",
    bio: "Works with builders who want their research prototypes to become useful tools for society.",
    availability: "Connect for prototype feedback"
  }
];

export const samplePapers: Paper[] = [
  {
    id: "quantum-error-threshold",
    title: "Quantum Error Correction Crosses a Major Threshold",
    domain: "Quantum Computing",
    summary:
      "Google researchers showed that adding more physical qubits can reduce logical errors, an important step toward reliable quantum computers.",
    fullExplanation:
      "Quantum computers are powerful but fragile: tiny disturbances can corrupt the information stored in qubits. This work demonstrates a surface-code error correction result where larger protected qubit groups behave more reliably. In simple words, it is like wrapping a delicate message in stronger and stronger packaging so it survives long enough to be useful.",
    authorId: "paper-team-1",
    authorName: "Google Quantum AI",
    authorRole: "Quantum Computing Research Team",
    originalLink: "https://www.nature.com/articles/s41586-024-08449-y",
    tags: ["quantum", "error-correction", "qubits"],
    readingTime: "4 min read",
    savedCount: 3840,
    createdAt: new Date("2025-02-01")
  },
  {
    id: "alphaqubit-decoder",
    title: "AI Helps Decode Quantum Computer Errors",
    domain: "AI / ML",
    summary:
      "A machine learning decoder can help identify quantum errors more accurately, making future quantum machines easier to stabilize.",
    fullExplanation:
      "Quantum systems produce noisy signals, and deciding which correction to apply is hard. This research uses AI to read patterns in those signals and suggest better corrections. For everyday readers: the AI acts like a smart spell-checker for a quantum computer, catching errors before they ruin the calculation.",
    authorId: "paper-team-2",
    authorName: "Google Research",
    authorRole: "Machine Learning for Quantum Systems",
    originalLink: "https://www.nature.com/articles/s41586-024-08148-8",
    tags: ["ai", "decoder", "quantum"],
    readingTime: "4 min read",
    savedCount: 2410,
    createdAt: new Date("2024-11-20")
  },
  {
    id: "ai-cancer-tissue-imaging",
    title: "AI Reads Cancer Tissue Images for Earlier Clues",
    domain: "AI / ML",
    summary:
      "Researchers reviewed how AI can study tissue images to support cancer detection, diagnosis, and research workflows.",
    fullExplanation:
      "Pathologists inspect tissue images to understand disease. AI can help by finding patterns across thousands of image regions and pointing out areas that deserve attention. The important idea is not replacing doctors; it is giving them a faster, consistent assistant so more patients can benefit from early and accurate review.",
    authorId: "paper-team-3",
    authorName: "Cancer Imaging Review Authors",
    authorRole: "Computational Pathology Researchers",
    originalLink: "https://arxiv.org/abs/2306.16989",
    tags: ["medical-ai", "pathology", "early-detection"],
    readingTime: "5 min read",
    savedCount: 2188,
    createdAt: new Date("2024-08-19")
  },
  {
    id: "soft-grippers-review",
    title: "Soft Robot Hands Can Grip Fragile Objects",
    domain: "Robotics",
    summary:
      "A broad review explains how soft grippers use flexible materials to handle delicate objects in medicine, farming, and labs.",
    fullExplanation:
      "Normal robot hands are strong but can be too rigid. Soft grippers bend, adapt, and spread pressure gently. That means a robot can pick up fruit, biological samples, or fragile tools without crushing them. The research direction matters because robots will work closer to humans and delicate environments.",
    authorId: "paper-team-4",
    authorName: "Soft Robotics Review Authors",
    authorRole: "Robotics Researchers",
    originalLink: "https://www.sciencedirect.com/science/article/abs/pii/S0924424724003741",
    tags: ["soft-robotics", "grippers", "automation"],
    readingTime: "3 min read",
    savedCount: 1760,
    createdAt: new Date("2024-10-12")
  },
  {
    id: "deep-sea-soft-gripper",
    title: "Wearable Soft Gripper Protects Deep-Sea Samples",
    domain: "Robotics",
    summary:
      "A soft robotic device helps researchers collect delicate underwater samples without damaging them.",
    fullExplanation:
      "Deep-sea creatures and artifacts can be extremely fragile. This gripper uses soft, controllable movement so a human operator can collect samples more carefully. For a non-expert, imagine a robot hand that behaves more like gentle fingers than metal claws.",
    authorId: "paper-team-5",
    authorName: "IEEE Robotics Authors",
    authorRole: "Marine Robotics Researchers",
    originalLink:
      "https://ramagazine.ieee.org/2024/04/05/a-nitinol-embedded-wearable-soft-robotic-gripper-for-deep-sea-manipulation-a-wearable-device-for-deep-sea-delicate-operation/",
    tags: ["deep-sea", "wearable", "soft-gripper"],
    readingTime: "3 min read",
    savedCount: 990,
    createdAt: new Date("2024-04-05")
  },
  {
    id: "perovskite-advances",
    title: "Perovskite Solar Cells Keep Getting Better",
    domain: "Renewable Energy",
    summary:
      "Recent work reviews how perovskite solar cells can offer low-cost, efficient, and easier-to-manufacture clean energy devices.",
    fullExplanation:
      "Perovskites are materials that can absorb sunlight very efficiently. Scientists are trying to make them stable, safe, and scalable. The simple takeaway: if these cells become durable enough, solar panels could become cheaper and easier to deploy in more places.",
    authorId: "paper-team-6",
    authorName: "Perovskite Review Authors",
    authorRole: "Renewable Energy Researchers",
    originalLink: "https://www.mdpi.com/2073-4352/14/10/862",
    tags: ["solar", "perovskite", "clean-energy"],
    readingTime: "4 min read",
    savedCount: 2014,
    createdAt: new Date("2024-09-30")
  },
  {
    id: "flexible-perovskite",
    title: "Flexible Solar Cells Could Power Everyday Surfaces",
    domain: "Renewable Energy",
    summary:
      "Flexible perovskite solar cells are being studied for indoor and outdoor use, including lightweight devices and curved surfaces.",
    fullExplanation:
      "Traditional solar panels are rigid. Flexible solar cells could sit on windows, wearable devices, or portable electronics. This review explains materials and design choices that may help flexible cells work reliably in real environments.",
    authorId: "paper-team-7",
    authorName: "Flexible Solar Review Authors",
    authorRole: "Materials and Energy Researchers",
    originalLink: "https://link.springer.com/article/10.1007/s40243-024-00257-8",
    tags: ["flexible-solar", "materials", "energy-access"],
    readingTime: "4 min read",
    savedCount: 1432,
    createdAt: new Date("2024-01-31")
  },
  {
    id: "autonomous-quantum-correction",
    title: "Quantum Chips Learn to Correct Some Errors Automatically",
    domain: "Quantum Computing",
    summary:
      "Researchers demonstrated a hardware-efficient approach where part of the quantum error correction process can happen autonomously.",
    fullExplanation:
      "Instead of constantly asking a computer to check and fix a qubit, this approach builds some correction behavior into the quantum hardware itself. For beginners, it is like designing a bridge that automatically absorbs small vibrations rather than needing manual repair every second.",
    authorId: "paper-team-8",
    authorName: "Nature Communications Authors",
    authorRole: "Quantum Hardware Researchers",
    originalLink: "https://www.nature.com/articles/s41467-024-45858-z",
    tags: ["quantum-hardware", "autonomous", "stability"],
    readingTime: "5 min read",
    savedCount: 1224,
    createdAt: new Date("2024-02-20")
  },
  {
    id: "space-ai-navigation",
    title: "AI Navigation Can Help Space Robots Explore Safely",
    domain: "Space Tech",
    summary:
      "Modern autonomy research is helping robots make safer decisions in unfamiliar environments like moons, asteroids, and planets.",
    fullExplanation:
      "Space robots cannot always wait for instructions from Earth because signals take time. AI navigation helps them understand terrain, avoid risky paths, and choose useful targets. The idea is to give explorers enough local intelligence to keep moving safely.",
    authorId: "paper-team-9",
    authorName: "shoRDs Research Desk",
    authorRole: "Space Technology Brief",
    originalLink: "https://www.nasa.gov/technology/",
    tags: ["space", "autonomy", "navigation"],
    readingTime: "3 min read",
    savedCount: 1120,
    createdAt: new Date("2024-06-18")
  },
  {
    id: "secure-ai-systems",
    title: "Secure AI Systems Need Stronger Guardrails",
    domain: "Cybersecurity",
    summary:
      "Security researchers are studying how AI systems can be attacked, misused, or fooled, and how software can defend against it.",
    fullExplanation:
      "AI systems can make mistakes if inputs are manipulated or if private data leaks through models. Cybersecurity research builds tests, monitoring, and safer deployment practices. In simple terms: as AI becomes common, we need locks, alarms, and good habits for intelligent software too.",
    authorId: "paper-team-10",
    authorName: "shoRDs Research Desk",
    authorRole: "Cybersecurity Brief",
    originalLink: "https://www.nist.gov/artificial-intelligence",
    tags: ["ai-safety", "cybersecurity", "trust"],
    readingTime: "3 min read",
    savedCount: 1568,
    createdAt: new Date("2024-05-24")
  },
  {
    id: "bioengineering-sensors",
    title: "Tiny Biosensors Can Make Health Monitoring Easier",
    domain: "Biotechnology",
    summary:
      "Biosensor research is making it possible to detect biological signals faster, cheaper, and closer to the patient.",
    fullExplanation:
      "A biosensor turns a biological signal into readable data. Better sensors could help doctors detect disease earlier or help people monitor health outside hospitals. The big promise is simple: useful health information can reach more people with less delay.",
    authorId: "paper-team-11",
    authorName: "shoRDs Research Desk",
    authorRole: "Biotechnology Brief",
    originalLink: "https://www.nih.gov/research-training",
    tags: ["biosensors", "health", "diagnostics"],
    readingTime: "3 min read",
    savedCount: 1372,
    createdAt: new Date("2024-04-16")
  },
  {
    id: "edge-electronics",
    title: "Edge Chips Bring AI Closer to Devices",
    domain: "Electronics",
    summary:
      "New electronics research is pushing AI computation from distant servers into phones, sensors, and embedded devices.",
    fullExplanation:
      "Edge AI means doing useful computation near the user instead of sending everything to the cloud. This can reduce delay, save bandwidth, and protect privacy. It matters for smart cameras, health devices, vehicles, and remote research tools.",
    authorId: "paper-team-12",
    authorName: "shoRDs Research Desk",
    authorRole: "Electronics Brief",
    originalLink: "https://www.ieee.org/",
    tags: ["edge-ai", "chips", "embedded"],
    readingTime: "3 min read",
    savedCount: 1296,
    createdAt: new Date("2024-03-11")
  }
];

export const currentUser: UserProfile = {
  id: "demo-user",
  name: "Abhin Researcher",
  email: "abhin@example.com",
  bio: "Learning emerging technology through simplified research discoveries.",
  interests: ["AI / ML", "Quantum Computing", "Space Tech"],
  profileImage: ""
};
