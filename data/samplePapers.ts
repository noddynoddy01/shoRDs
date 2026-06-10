import { Domain, Mentor, Paper, UserProfile } from "@/types/models";

export const domains: Domain[] = [
  "AI / ML",
  "Robotics",
  "Electronics",
  "Quantum Computing",
  "Space Tech",
  "Biotechnology",
  "Cybersecurity",
  "Renewable Energy",
  "Nanotechnology",
  "Genetics",
  "Material Science",
  "Climate Tech",
  "Blockchain & Web3",
  "Neuroscience",
  "Nuclear Fusion",
  "Medical Devices",
  "IoT & Edge Computing"
];

export const mentors: Mentor[] = [
  {
    id: "abhinav-ai",
    name: "Abhinav Prakash",
    title: "Platform Owner & AI Research Lead",
    focus: "shoRDs Platform Architecture & AI Integrations",
    affiliation: "shoRDs Research Circle",
    bio: "Developer and owner of shoRDs. Ask him anything about the platform architecture, paper summaries, or deploying AI models.",
    availability: "Online 24/7 (AI Assistant)"
  },
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
      "🔬 [Context & Background]\nQuantum computing holds the promise of solving complex computational problems. However, physical qubits are highly susceptible to environmental noise and decoherence, leading to computational errors. This work investigates surface codes to active correct errors in real-time.\n\n⚙️ [Technical Methodology]\nThe research team constructed a superconducting processor implementing a distance-5 surface code. By continuously reading out stabilizer generators, the system detects physical qubit errors and decodes them in real time without disturbing the logical state.\n\n📊 [Key Results & Findings]\nThe distance-5 logical qubit demonstrated a lower error rate than a distance-3 logical qubit, crossing the critical physical-to-logical error suppression threshold. Physical error rates below 0.1% were successfully decoded.\n\n🔮 [Future Scope & Horizons]\nThe next milestone is scaling to distance-7 and larger surface codes to achieve fault-tolerant logical error rates below 10^-6, which is necessary for running complex quantum algorithms.",
    authorId: "paper-team-1",
    authorName: "Google Quantum AI",
    authorRole: "Quantum Computing Research Team",
    originalLink: "https://www.nature.com/articles/s41586-024-08449-y",
    tags: ["quantum", "error-correction", "qubits"],
    readingTime: "4 min read",
    savedCount: 3840,
    createdAt: new Date("2025-02-01"),
    organization: "Nature Publishing Group",
    pubYear: 2025,
    doi: "10.1038/s41586-024-08449-y",
    insights: [
      "Demonstrated physical-to-logical error suppression threshold on a superconducting processor.",
      "A distance-5 surface code performs better than a distance-3 code for real-time stabilizing.",
      "Limits logical error rates to allow running high-depth quantum circuits in the future."
    ],
    audioUrl: "https://shords.app/audio/quantum-error.mp3",
    videoUrl: "https://shords.app/video/quantum-error.mp4",
    translations: {
      es: {
        title: "La corrección de errores cuánticos cruza un umbral importante",
        summary: "Los investigadores de Google demostraron que agregar más qubits físicos puede reducir los errores lógicos, un paso importante hacia las computadoras cuánticas confiables.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nLa computación cuántica promete resolver problemas computacionales complejos. Sin embargo, los qubits físicos son muy susceptibles al ruido ambiental y a la decoherencia, lo que genera errores.\n\n⚙️ [Metodología Técnica]\nEl equipo construyó un procesador superconductor con código de superficie de distancia 5.\n\n📊 [Resultados Clave]\nEl qubit lógico de distancia 5 demostró una tasa de error más baja que la distancia 3, superando el umbral crítico.\n\n🔮 [Alcance Futuro]\nEl próximo hito es escalar a códigos de distancia 7 y lograr tasas de error inferiores a 10^-6."
      },
      hi: {
        title: "क्वांटम त्रुटि सुधार एक बड़े मुकाम को पार करता है",
        summary: "गूगल के शोधकर्ताओं ने दिखाया कि अधिक भौतिक क्वैबिट जोड़ने से तार्किक त्रुटियां कम हो सकती हैं, जो विश्वसनीय क्वांटम कंप्यूटर की ओर एक महत्वपूर्ण कदम है।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nक्वांटम कंप्यूटिंग जटिल समस्याओं को हल करने का वादा करती है। हालांकि, भौतिक क्वैबिट पर्यावरणीय शोर और विसंगति के प्रति अत्यधिक संवेदनशील होते हैं, जिससे त्रुटियां होती हैं।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nशोध दल ने दूरी-5 सतह कोड का उपयोग करते हुए एक सुपरकंडक्टिंग प्रोसेसर का निर्माण किया।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nदूरी-5 तार्किक क्वैबिट ने दूरी-3 तार्किक क्वैबिट की तुलना में कम त्रुटि दर का प्रदर्शन किया।\n\n🔮 [भविष्य की संभावना]\nअगला लक्ष्य दूरी-7 सतह कोड को स्केल करना और तार्किक त्रुटि दरों को 10^-6 से नीचे लाना है।"
      }
    }
  },
  {
    id: "alphaqubit-decoder",
    title: "AI Helps Decode Quantum Computer Errors",
    domain: "AI / ML",
    summary:
      "A machine learning decoder can help identify quantum errors more accurately, making future quantum machines easier to stabilize.",
    fullExplanation:
      "🔬 [Context & Background]\nIdentifying quantum errors requires processing complex, noisy signals from physical qubits. Traditional decoding algorithms are slow and computationally expensive, creating a bottleneck for real-time error correction.\n\n⚙️ [Technical Methodology]\nWe present AlphaQubit, a machine learning decoder based on transformer architectures. It reads error syndrome histories and outputs optimal correction operators. The model is trained on simulated and real processor noise profiles.\n\n📊 [Key Results & Findings]\nAlphaQubit achieves a 30% reduction in logical error rates compared to minimum-weight perfect matching (MWPM) decoders. It maintains high fidelity even in regimes with severe spatial cross-talk.\n\n🔮 [Future Scope & Horizons]\nFuture efforts will optimize the model's inference speed to sub-microsecond levels, enabling inline deployment on hardware-level FPGA controllers.",
    authorId: "paper-team-2",
    authorName: "Google Research",
    authorRole: "Machine Learning for Quantum Systems",
    originalLink: "https://www.nature.com/articles/s41586-024-08148-8",
    tags: ["ai", "decoder", "quantum"],
    readingTime: "4 min read",
    savedCount: 2410,
    createdAt: new Date("2024-11-20"),
    organization: "Nature Publishing Group",
    pubYear: 2024,
    doi: "10.1038/s41586-024-08148-8",
    insights: [
      "Introduces AlphaQubit, a neural decoder utilizing transformer layers for syndrome matching.",
      "Outperforms MWPM algorithms by 30% in error prediction accuracy.",
      "Lays the foundation for microsecond-level hardware-in-the-loop decoding."
    ],
    audioUrl: "https://shords.app/audio/alphaqubit.mp3",
    videoUrl: "https://shords.app/video/alphaqubit.mp4",
    translations: {
      es: {
        title: "La IA ayuda a descodificar los errores de los ordenadores cuánticos",
        summary: "Un decodificador de aprendizaje automático puede ayudar a identificar los errores cuánticos con mayor precisión, haciendo que las futuras máquinas cuánticas sean más fáciles de estabilizar.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nIdentificar los errores cuánticos requiere procesar señales complejas y ruidosas de los qubits físicos.\n\n⚙️ [Metodología Técnica]\nPresentamos AlphaQubit, un decodificador de aprendizaje automático basado en arquitecturas de transformadores.\n\n📊 [Resultados Clave]\nAlphaQubit logra una reducción del 30% en las tasas de error lógico en comparación con decodificadores tradicionales.\n\n🔮 [Alcance Futuro]\nLos esfuerzos futuros optimizarán la velocidad de inferencia a niveles inferiores al microsegundo."
      },
      hi: {
        title: "एआई क्वांटम कंप्यूटर की त्रुटियों को समझने में मदद करता है",
        summary: "एक मशीन लर्निंग डिकोडर क्वांटम त्रुटियों को अधिक सटीक रूप से पहचानने में मदद कर सकता है, जिससे भविष्य की क्वांटम मशीनों को स्थिर करना आसान हो जाएगा।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nक्वांटम त्रुटियों की पहचान करने के लिए भौतिक क्वैबिट से जटिल, शोर संकेतों को संसाधित करने की आवश्यकता होती है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nहम अल्फाक्वैबिट प्रस्तुत करते हैं, जो ट्रांसफॉर्मर आर्किटेक्चर पर आधारित एक मशीन लर्निंग डिकोडर है।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nअल्फाक्वैबिट ने पारंपरिक डिकोडर्स की तुलना में तार्किक त्रुटि दरों में 30% की कमी हासिल की है।\n\n🔮 [भविष्य की संभावना]\nभविष्य के प्रयास मॉडल की अनुमान गति को उप-माइक्रोसेकंड स्तर तक अनुकूलित करेंगे।"
      }
    }
  },
  {
    id: "ai-cancer-tissue-imaging",
    title: "AI Reads Cancer Tissue Images for Earlier Clues",
    domain: "AI / ML",
    summary:
      "Researchers reviewed how AI can study tissue images to support cancer detection, diagnosis, and research workflows.",
    fullExplanation:
      "🔬 [Context & Background]\nPathological diagnosis of cancer is highly dependent on microscopic analysis of tissue biopsy slides. The process is time-consuming and prone to observer variability, especially in early-stage tumor identification.\n\n⚙️ [Technical Methodology]\nThis review details deep learning architectures used in computational pathology. It covers convolutional neural networks (CNNs) and vision transformers (ViTs) applied to gigapixel whole-slide images (WSIs).\n\n📊 [Key Results & Findings]\nAI systems show sensitivity rates above 95% in detecting micro-metastases in lymph nodes. They assist pathologists by highlighting suspicious regions, reducing diagnostic review times by 40%.\n\n🔮 [Future Scope & Horizons]\nIntegration of multi-modal AI combining image features with spatial transcriptomics and genomic data is the next frontier for personalized cancer prognosis.",
    authorId: "paper-team-3",
    authorName: "Cancer Imaging Review Authors",
    authorRole: "Computational Pathology Researchers",
    originalLink: "https://arxiv.org/abs/2306.16989",
    tags: ["medical-ai", "pathology", "early-detection"],
    readingTime: "5 min read",
    savedCount: 2188,
    createdAt: new Date("2024-08-19"),
    organization: "arXiv Org",
    pubYear: 2024,
    doi: "10.48550/arXiv.2306.16989",
    insights: [
      "Summarizes CNN and vision transformer techniques for gigapixel pathological image assessment.",
      "Saves up to 40% of time for diagnostic pathologists by surfacing tumor borders automatically.",
      "Identifies a 95%+ detection accuracy rate on lymph node WSI screenings."
    ]
  },
  {
    id: "soft-grippers-review",
    title: "Soft Robot Hands Can Grip Fragile Objects",
    domain: "Robotics",
    summary:
      "A broad review explains how soft grippers use flexible materials to handle delicate objects in medicine, farming, and labs.",
    fullExplanation:
      "🔬 [Context & Background]\nRigid robotic grippers frequently damage delicate payloads like fresh fruits, biological tissues, or glass vials. Soft robotics offers compliance, safety, and adaptability during manipulation.\n\n⚙️ [Technical Methodology]\nWe review the design, materials, and fabrication of soft pneumatic, magnetic, and tendon-driven actuators. We focus on elastomer-based designs and soft sensory integration.\n\n📊 [Key Results & Findings]\nSoft grippers distribute contact forces uniformly, reducing peak local pressures by over 80%. Payloads ranging from fresh berries to thin-walled test tubes were gripped securely without failure.\n\n🔮 [Future Scope & Horizons]\nDeveloping bio-degradable elastomers and embedding flexible sensors for closed-loop haptic feedback represents the next major research direction.",
    authorId: "paper-team-4",
    authorName: "Soft Robotics Review Authors",
    authorRole: "Robotics Researchers",
    originalLink: "https://www.sciencedirect.com/science/article/abs/pii/S0924424724003741",
    tags: ["soft-robotics", "grippers", "automation"],
    readingTime: "3 min read",
    savedCount: 1760,
    createdAt: new Date("2024-10-12"),
    organization: "IEEE Explorer",
    pubYear: 2024,
    doi: "10.1016/j.sna.2024.115024",
    insights: [
      "Analyzes elastomer designs for mechanical adaptation without sensory overhead.",
      "Reduces structural peak pressures by 80% on fragile materials.",
      "Suggests haptic integration to allow closed-loop force adjustments in soft fingertips."
    ]
  },
  {
    id: "deep-sea-soft-gripper",
    title: "Wearable Soft Gripper Protects Deep-Sea Samples",
    domain: "Robotics",
    summary:
      "A soft robotic device helps researchers collect delicate underwater samples without damaging them.",
    fullExplanation:
      "🔬 [Context & Background]\nCollecting fragile marine specimens at extreme depths requires gentle contact forces. Conventional robotic arms on remotely operated vehicles (ROVs) often crush delicate corals and jelly-like organisms.\n\n⚙️ [Technical Methodology]\nThis paper presents a soft gripper actuated by Nitinol shape-memory alloy (SMA) springs. The design is integrated into a wearable glove interface, allowing human operators to control the arm via haptic telemetry.\n\n📊 [Key Results & Findings]\nThe SMA-driven soft gripper successfully retrieved soft corals and glass sponges at depths exceeding 2,000 meters. Force sensors confirmed pressure did not exceed 0.05 N/cm^2.\n\n🔮 [Future Scope & Horizons]\nIntegrating acoustic sensors onto the gripper fingertips will enable ROV operators to measure sample density prior to extraction.",
    authorId: "paper-team-5",
    authorName: "IEEE Robotics Authors",
    authorRole: "Marine Robotics Researchers",
    originalLink:
      "https://ramagazine.ieee.org/2024/04/05/a-nitinol-embedded-wearable-soft-robotic-gripper-for-deep-sea-manipulation-a-wearable-device-for-deep-sea-delicate-operation/",
    tags: ["deep-sea", "wearable", "soft-gripper"],
    readingTime: "3 min read",
    savedCount: 990,
    createdAt: new Date("2024-04-05"),
    organization: "IEEE Explorer",
    pubYear: 2024,
    doi: "10.1109/MRA.2024.3364024"
  },
  {
    id: "perovskite-advances",
    title: "Perovskite Solar Cells Keep Getting Better",
    domain: "Renewable Energy",
    summary:
      "Recent work reviews how perovskite solar cells can offer low-cost, efficient, and easier-to-manufacture clean energy devices.",
    fullExplanation:
      "🔬 [Context & Background]\nSilicon solar cells are highly efficient but require expensive, high-temperature manufacturing. Perovskite solar cells offer a solution due to low-cost solution processing and tunable bandgaps.\n\n⚙️ [Technical Methodology]\nWe review the chemical composition of hybrid organic-inorganic perovskites, focusing on surface passivation techniques that reduce charge recombination at material interfaces.\n\n📊 [Key Results & Findings]\nPerovskite solar cell efficiency has climbed from 3.8% in 2009 to over 26% in laboratory settings, rivaling silicon cells. However, stability under high humidity remains a challenge.\n\n🔮 [Future Scope & Horizons]\nDeveloping mixed-halide perovskites with high chemical stability and testing lead-free double perovskites for environment safety.",
    authorId: "paper-team-6",
    authorName: "Perovskite Review Authors",
    authorRole: "Renewable Energy Researchers",
    originalLink: "https://www.mdpi.com/2073-4352/14/10/862",
    tags: ["solar", "perovskite", "clean-energy"],
    readingTime: "4 min read",
    savedCount: 2014,
    createdAt: new Date("2024-09-30"),
    organization: "Science Publishing Group",
    pubYear: 2024,
    doi: "10.3390/cryst14100862"
  },
  {
    id: "flexible-perovskite",
    title: "Flexible Solar Cells Could Power Everyday Surfaces",
    domain: "Renewable Energy",
    summary:
      "Flexible perovskite solar cells are being studied for indoor and outdoor use, including lightweight devices and curved surfaces.",
    fullExplanation:
      "🔬 [Context & Background]\nTraditional solar installations are rigid and heavy, limiting deployment on curved walls, vehicles, or wearable textiles. Flexible solar cells address this constraint.\n\n⚙️ [Technical Methodology]\nThis paper details roll-to-roll printing of perovskite cells on flexible polyethylene... [Truncated for brevity]",
    authorId: "paper-team-7",
    authorName: "Flexible Solar Review Authors",
    authorRole: "Materials and Energy Researchers",
    originalLink: "https://link.springer.com/article/10.1007/s40243-024-00257-8",
    tags: ["flexible-solar", "materials", "energy-access"],
    readingTime: "4 min read",
    savedCount: 1432,
    createdAt: new Date("2024-01-31"),
    organization: "Springer Materials",
    pubYear: 2024,
    doi: "10.1007/s40243-024-00257-8"
  }
];

export const currentUser: UserProfile = {
  id: "demo-user",
  name: "Abhin Researcher",
  email: "abhin@example.com",
  bio: "Learning emerging technology through simplified research discoveries.",
  interests: ["AI / ML", "Quantum Computing", "Space Tech"],
  profileImage: "",
  role: "user"
};
