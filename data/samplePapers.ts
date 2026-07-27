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

export const domainSubtopics: Record<string, string[]> = {
  "AI / ML": ["Large Language Models", "Computer Vision", "Reinforcement Learning", "AI Safety & Ethics", "Neural Architectures"],
  "Robotics": ["Soft Robotics", "Autonomous Navigation", "Human-Robot Interaction", "Swarm Robotics"],
  "Electronics": ["Semiconductors", "Flexible Electronics", "VLSI Design", "Optoelectronics"],
  "Quantum Computing": ["Quantum Error Correction", "Quantum Cryptography", "Superconducting Qubits", "Quantum Algorithms"],
  "Space Tech": ["Plasma Propulsion", "Satellite Systems", "Deep Space Missions", "Astrophysics"],
  "Biotechnology": ["Gene Editing (CRISPR)", "Synthetic Biology", "Biomaterials", "Tissue Engineering", "Bioinformatics"],
  "Cybersecurity": ["Zero-Trust Architectures", "Post-Quantum Cryptography", "Intrusion Detection", "Cryptographic Protocols"],
  "Renewable Energy": ["Perovskite Solar Cells", "Battery Tech & Storage", "Hydrogen Fuel Cells", "Bioenergy"],
  "Nanotechnology": ["Nanomaterials", "Nanorobotics", "Quantum Dots", "Nanoelectronics"],
  "Genetics": ["Epigenetics", "Genome Sequencing", "Gene Therapy", "Functional Genomics"],
  "Material Science": ["Superconductors", "Metamaterials", "Smart Materials", "Alloys & Composites"],
  "Climate Tech": ["Carbon Capture", "Climate Modeling", "Grid Modernization", "Renewable Integration"],
  "Blockchain & Web3": ["Consensus Mechanisms", "Decentralized Finance (DeFi)", "Smart Contract Security", "Zero-Knowledge Proofs"],
  "Neuroscience": ["Brain-Computer Interfaces", "Neural Plasticity", "Neurodegenerative Diseases", "Cognitive Neuroscience"],
  "Nuclear Fusion": ["Magnetic Confinement", "Inertial Confinement", "Plasma Physics", "Fusion Materials"],
  "Medical Devices": ["Biosensors", "Implantable Devices", "Prosthetics", "Diagnostic Imaging"],
  "IoT & Edge Computing": ["Edge Inference", "Sensor Networks", "Smart Infrastructure", "Fog Computing"]
};

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
    subdomain: "Quantum Error Correction",
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
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: Logical vs Physical Error Rates", "labels": ["d=3", "d=5", "d=7"], "values": [12, 4, 1]}`
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
    subdomain: "Neural Architectures",
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
    illustrations: [
      `{"type": "bar-chart", "title": "Figure 1: Logical Error Rate Reduction (%)", "labels": ["MWPM", "Union-Find", "AlphaQubit"], "values": [100, 85, 70]}`
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
    subdomain: "Computer Vision",
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
    ],
    illustrations: [
      `{"type": "flow-chart", "title": "Figure 1: WSI Pathology Pipeline", "steps": ["Biopsy Input", "Tile Extraction", "ViT Feature Map", "Pathologist Highlight"]}`
    ]
  },
  {
    id: "soft-grippers-review",
    title: "Soft Robot Hands Can Grip Fragile Objects",
    domain: "Robotics",
    subdomain: "Soft Robotics",
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
    ],
    illustrations: [
      `{"type": "bar-chart", "title": "Figure 1: Contact Pressure Distribution (kPa)", "labels": ["Metal Claw", "Rubber Claw", "Soft Gripper"], "values": [120, 48, 8]}`
    ]
  },
  {
    id: "deep-sea-soft-gripper",
    title: "Wearable Soft Gripper Protects Deep-Sea Samples",
    domain: "Robotics",
    subdomain: "Soft Robotics",
    summary:
      "A soft robotic device helps researchers collect delicate underwater samples without damaging them.",
    fullExplanation:
      "🔬 [Context & Background]\nCollecting fragile marine specimens at extreme depths requires gentle contact forces. Conventional robotic arms on remotely operated vehicles (ROVs) often crush delicate corals and jelly-like organisms.\n\n⚙️ [Technical Methodology]\nThis paper presents a soft gripper actuated by Nitinol shape-memory alloy (SMA) springs. The design is integrated into a wearable glove interface, allowing human operators to control the arm via haptic telemetry.\n\n📊 [Key Results & Findings]\nThe SMA-driven soft gripper successfully retrieved soft corals and glass sponges at depths exceeding 2,000 meters. Force sensors confirmed pressure did not exceed 0.05 N/cm^2.\n\n🔮 [Future Scope & Horizons]\nIntegrating acoustic sensors onto the gripper fingertips will enable ROV operators to measure sample density prior to extraction.",
    authorId: "paper-team-5",
    authorName: "IEEE Robotics Authors",
    authorRole: "Marine Robotics Researchers",
    originalLink: "https://ramagazine.ieee.org/2024/04/05/a-nitinol-embedded-wearable-soft-robotic-gripper-for-deep-sea-manipulation-a-wearable-device-for-deep-sea-delicate-operation/",
    tags: ["deep-sea", "wearable", "soft-gripper"],
    readingTime: "3 min read",
    savedCount: 990,
    createdAt: new Date("2024-04-05"),
    organization: "IEEE Explorer",
    pubYear: 2024,
    doi: "10.1109/MRA.2024.3364024",
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: SMA Output Force Over Cycles", "labels": ["C1", "C50", "C100", "C200"], "values": [95, 94, 93, 91]}`
    ]
  },
  {
    id: "perovskite-advances",
    title: "Perovskite Solar Cells Keep Getting Better",
    domain: "Renewable Energy",
    subdomain: "Perovskite Solar Cells",
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
    doi: "10.3390/cryst14100862",
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: Efficiency Development Over Time (%)", "labels": ["2009", "2014", "2019", "2024"], "values": [3, 14, 21, 26]}`
    ]
  },
  {
    id: "flexible-perovskite",
    title: "Flexible Solar Cells Could Power Everyday Surfaces",
    domain: "Renewable Energy",
    subdomain: "Perovskite Solar Cells",
    summary:
      "Flexible perovskite solar cells are being studied for indoor and outdoor use, including lightweight devices and curved surfaces.",
    fullExplanation:
      "🔬 [Context & Background]\nTraditional solar installations are rigid and heavy, limiting deployment on curved walls, vehicles, or wearable textiles. Flexible solar cells address this constraint.\n\n⚙️ [Technical Methodology]\nThis paper details roll-to-roll printing of perovskite cells on flexible polyethylene terephthalate (PET) substrates. It utilizes low-temperature carbon paste electrodes to avoid damaging the underlying organic-inorganic layers.\n\n📊 [Key Results & Findings]\nThe manufactured flexible cells achieved a power conversion efficiency (PCE) of 18.2% and maintained 90% of their initial performance after 1,000 bending cycles at a 10mm radius.\n\n🔮 [Future Scope & Horizons]\nFuture work targets scaling active surface areas using slot-die coating processes and improving moisture barrier encapsulation to increase device operating lifespans.",
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
    doi: "10.1007/s40243-024-00257-8",
    illustrations: [
      `{"type": "bar-chart", "title": "Figure 1: Retention After Bending Cycles (%)", "labels": ["C0", "C200", "C500", "C1000"], "values": [100, 98, 95, 90]}`
    ]
  },
  {
    id: "biotech-gene-editing",
    title: "CRISPR-Cas12a Gene Editing Precision Breakthrough",
    domain: "Biotechnology",
    subdomain: "Gene Editing (CRISPR)",
    summary:
      "Researchers engineered a high-fidelity Cas12a variant that virtually eliminates off-target DNA cleavage, bringing gene therapies closer to safe human trials.",
    fullExplanation:
      "🔬 [Context & Background]\nCRISPR gene editing technologies hold massive potential for curing genetic diseases. However, off-target editing (unintentional cleavage at similar genomic sequences) remains a key safety concern that blocks clinical translation.\n\n⚙️ [Technical Methodology]\nWe engineered a high-fidelity variant of Cas12a (named hyper-Cas12a) through rational design. We introduced amino acid mutations at the protein-DNA interface to weaken non-specific electrostatic interactions, thereby raising the mismatch discrimination threshold.\n\n📊 [Key Results & Findings]\nIn human cell lines, hyper-Cas12a achieved a 99.8% reduction in off-target editing compared to wild-type Cas12a. It maintained comparable on-target editing efficiency (above 85%) at multiple therapeutic loci.\n\n🔮 [Future Scope & Horizons]\nNext steps involve testing the engineered endonuclease in vivo in animal models and scaling up vector packaging configurations for delivering gene therapy payloads to liver and muscle tissues.",
    authorId: "paper-team-8",
    authorName: "Genetics Lab Team",
    authorRole: "Molecular Engineering Group",
    originalLink: "https://arxiv.org/abs/2402.xxxxx",
    tags: ["crispr", "gene-editing", "precision"],
    readingTime: "5 min read",
    savedCount: 1980,
    createdAt: new Date("2025-05-12"),
    organization: "Nature Biotechnology",
    pubYear: 2025,
    doi: "10.1038/nbt.2025.xxxx",
    illustrations: [
      `{"type": "bar-chart", "title": "Figure 1: Off-Target Cleavage Count", "labels": ["WT-Cas9", "WT-Cas12a", "Hyper-Cas12"], "values": [140, 32, 1]}`
    ]
  },
  {
    id: "space-propulsion-plasma",
    title: "Next-Gen Plasma Thruster for Deep-Space Exploration",
    domain: "Space Tech",
    subdomain: "Plasma Propulsion",
    summary:
      "Engineers validated an advanced plasma thruster operating at 100kW, demonstrating a 3x increase in fuel efficiency compared to conventional chemical rockets.",
    fullExplanation:
      "🔬 [Context & Background]\nDeep-space missions to Mars and beyond require high-efficiency propulsion systems. Conventional chemical thrusters are fuel-heavy, limiting payload capacities and increasing transit times.\n\n⚙️ [Technical Methodology]\nThis paper details the design and testing of a 100kW Magnetoplasmadynamic (MPD) thruster. It utilizes magnetic nozzles to guide and accelerate high-temperature Argon plasma, generating high thrust density without physical electrode degradation.\n\n📊 [Key Results & Findings]\nThe MPD thruster achieved a specific impulse (Isp) of 4,500 seconds, representing a threefold increase in fuel efficiency. The engine ran continuously for 200 hours in a high-vacuum simulation chamber without structural degradation.\n\n🔮 [Future Scope & Horizons]\nFuture research will focus on integrating high-temperature superconducting magnets to increase thrust output and testing the system with lightweight nuclear power reactor grids.",
    authorId: "paper-team-9",
    authorName: "Space Tech Research Lab",
    authorRole: "Propulsion Engineering Team",
    originalLink: "https://arxiv.org/abs/2403.xxxxx",
    tags: ["plasma-thruster", "deep-space", "propulsion"],
    readingTime: "4 min read",
    savedCount: 2240,
    createdAt: new Date("2025-06-15"),
    organization: "AIAA Journal",
    pubYear: 2025,
    doi: "10.2514/1.xxxx",
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: Specific Impulse (Isp in seconds)", "labels": ["Chemical", "Ion", "MPD Thruster"], "values": [450, 3000, 4500]}`
    ]
  },
  {
    id: "cybersecurity-zero-trust",
    title: "Quantum-Resistant Cryptography in Zero-Trust Edge Systems",
    domain: "Cybersecurity",
    subdomain: "Post-Quantum Cryptography",
    summary:
      "A new post-quantum cryptographic protocol secures internet-of-things devices against future quantum computer decryption attacks without increasing hardware latency.",
    fullExplanation:
      "🔬 [Context & Background]\nFuture quantum computers will be capable of breaking current asymmetric cryptography (like RSA/ECC). Edge devices with limited compute resources need immediate security upgrades to prevent future decryption attacks.\n\n⚙️ [Technical Methodology]\nWe propose a zero-trust post-quantum protocol utilizing lattice-based cryptography (based on Module-LWE). The protocol is co-designed with low-power hardware acceleration units to run efficiently on embedded microcontrollers.\n\n📊 [Key Results & Findings]\nThe protocol registers a 12x reduction in encryption latency compared to baseline Kyber implementations on resource-constrained microchips, while preserving security bounds equivalent to AES-256.\n\n🔮 [Future Scope & Horizons]\nWe plan to deploy this protocol across smart grid smart meters and investigate lightweight key distribution frameworks for satellite networks.",
    authorId: "paper-team-10",
    authorName: "Cyber Security Alliance",
    authorRole: "Cryptography Research Lead",
    originalLink: "https://arxiv.org/abs/2404.xxxxx",
    tags: ["post-quantum", "cryptography", "edge-security"],
    readingTime: "4 min read",
    savedCount: 1890,
    createdAt: new Date("2025-07-20"),
    organization: "IEEE Security & Privacy",
    pubYear: 2025,
    doi: "10.1109/MSP.2025.xxxx",
    illustrations: [
      `{"type": "flow-chart", "title": "Figure 1: Key Exchange Flow", "steps": ["Edge Request", "Lattice Seed Gen", "Public Key Swap", "Shared Secret Set"]}`
    ]
  },
  {
    id: "llama-3-foundation",
    title: "Llama 3: Open Foundation and Fine-Tuned Chat Models",
    domain: "AI / ML",
    subdomain: "Large Language Models",
    summary:
      "Meta introduced Llama 3, a state-of-the-art open-weights model family trained on over 15 trillion tokens to optimize multilingual and coding performance.",
    fullExplanation:
      "🔬 [Context & Background]\nLarge language models have revolutionized technology, but access to high-performance open-weights models remains crucial for custom enterprise builds. Llama 3 aims to match closed frontier models by optimizing the scaling laws of pretraining data.\n\n⚙️ [Technical Methodology]\nWe built a standard decoder-only transformer architecture with a grouped-query attention mechanism and a massive 128k token vocabulary. The pre-training pipeline processes text, code, and multilingual datasets totaling 15 trillion tokens on high-density GPU clusters.\n\n📊 [Key Results & Findings]\nLlama 3 70B shows state-of-the-art capabilities, scoring 82% on MMLU and 80.5% on HumanEval coding tasks, outperforming prior open models by substantial margins while maintaining safe alignment benchmarks.\n\n🔮 [Future Scope & Horizons]\nFuture models will support multimodal inputs, context windows extending beyond 128k, and autonomous agent tool-calling loops for multi-hop scientific reasoning.",
    authorId: "paper-team-11",
    authorName: "Meta AI",
    authorRole: "AI Research Group",
    originalLink: "https://arxiv.org/abs/2407.21783",
    tags: ["llama3", "llm", "transformer", "open-source"],
    readingTime: "5 min read",
    savedCount: 4210,
    createdAt: new Date("2025-07-15"),
    organization: "Meta AI Research",
    pubYear: 2024,
    doi: "10.48550/arXiv.2407.21783",
    insights: [
      "Trained on 15T+ tokens using a custom 128k vocabulary tokenizer.",
      "Outperforms comparable models on GSM8k, HumanEval, and MMLU benchmarks.",
      "Integrates RLHF with direct preference optimization for safe interactive chat."
    ],
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: Benchmark Score vs Training Tokens (T)", "labels": ["1T", "5T", "10T", "15T"], "values": [45, 68, 77, 82]}`,
      `{"type": "flow-chart", "title": "Figure 2: Alignment Pipeline", "steps": ["Pretraining", "Supervised FT", "Direct DPO", "Safety Guardrails"]}`
    ],
    translations: {
      es: {
        title: "Llama 3: Modelos de chat de base abierta y ajustados",
        summary: "Meta presentó la familia de modelos Llama 3, entrenada con más de 15 billones de tokens para optimizar el rendimiento de programación y multilingüe.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nEl acceso a modelos abiertos de alto rendimiento es crucial. Llama 3 busca igualar a los modelos comerciales mediante la optimización de las leyes de escala de datos.\n\n⚙️ [Metodología Técnica]\nConstruimos una arquitectura de transformador decodificador con atención de consulta agrupada y vocabulario de 128k.\n\n📊 [Resultados Clave]\nLlama 3 70B supera a los modelos abiertos anteriores con 82% en MMLU y 80.5% en HumanEval.\n\n🔮 [Alcance Futuro]\nModelos futuros soportarán entradas multimodales y razonamiento autónomo."
      },
      hi: {
        title: "लामा 3: ओपन फाउंडेशन और फाइन-ट्यून किए गए चैट मॉडल",
        summary: "मेटा ने लामा 3 पेश किया, जो एक अत्याधुनिक ओपन-वेट मॉडल है और जिसे कोडिंग प्रदर्शन को अनुकूलित करने के लिए 15 ट्रिलियन से अधिक टोकन पर प्रशिक्षित किया गया है।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nसॉफ्टवेयर विकास और बहुभाषी उपयोग के लिए उच्च प्रदर्शन वाले ओपन-सोर्स मॉडल की आवश्यकता होती है। लामा 3 इसी कमी को दूर करता है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nहमने ग्रुप-क्वेरी अटेंशन और 128k वोकैबुलरी वाले ट्रांसफॉर्मर आर्किटेक्चर का निर्माण किया।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nलामा 3 ने MMLU पर 82% और HumanEval कोडिंग कार्यों पर 80.5% का उत्कृष्ट स्कोर हासिल किया।\n\n🔮 [भविष्य की संभावना]\nभविष्य के मॉडल मल्टीमोडालिटी और स्वायत्त एजेंट रीजनिंग का समर्थन करेंगे।"
      }
    }
  },
  {
    id: "sora-video-generation",
    title: "Sora: Video Generation with Diffusion Transformers",
    domain: "AI / ML",
    subdomain: "Computer Vision",
    summary:
      "A text-conditional diffusion transformer model trained on joint space-time patches to generate up to 60 seconds of coherent photorealistic video.",
    fullExplanation:
      "🔬 [Context & Background]\nGenerating high-quality video from text prompts requires models to understand temporal consistency and spatial geometry. Previous approaches suffered from structural morphing and short generation bounds.\n\n⚙️ [Technical Methodology]\nSora is a diffusion transformer (DiT) architecture that operates on space-time patches of video data. It compresses video into a latent space, decomposes it into patches, and denoises these patches conditional on text embeddings.\n\n📊 [Key Results & Findings]\nThe model generates up to 60 seconds of video with complex camera motions, detailed textures, and physical object persistence, significantly outperforming prior autoregressive or GAN approaches.\n\n🔮 [Future Scope & Horizons]\nIntegrating precise physics engine constraint boundaries to prevent unrealistic collisions or gravity anomalies in generated virtual worlds.",
    authorId: "paper-team-12",
    authorName: "OpenAI Team",
    authorRole: "Generative Video Group",
    originalLink: "https://openai.com/research/video-generation-models-as-world-simulators",
    tags: ["sora", "diffusion", "dit", "video-gen"],
    readingTime: "4 min read",
    savedCount: 3950,
    createdAt: new Date("2025-02-15"),
    organization: "OpenAI Research",
    pubYear: 2024,
    doi: "10.48550/arXiv.2402.xxxxx",
    insights: [
      "Treats video frames as space-time patches, similar to vision transformer patches.",
      "Resolves spatial consistency and temporal continuity over extended 60-second clips.",
      "Unlocks physical world simulations including object persistence and camera motions."
    ],
    illustrations: [
      `{"type": "flow-chart", "title": "Figure 1: Spatio-Temporal Diffusion Flow", "steps": ["Video Compression", "Patch Extraction", "DiT Denoising", "Latent Video Output"]}`,
      `{"type": "bar-chart", "title": "Figure 2: Generation Coherence Score (1-10)", "labels": ["GANs", "Diffusion v1", "Sora"], "values": [3, 5, 9]}`
    ],
    translations: {
      es: {
        title: "Sora: Generación de video con transformadores de difusión",
        summary: "Un modelo de difusión condicionado por texto que genera hasta 60 segundos de video fotorrealista coherente.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nGenerar video desde texto requiere comprender la geometría y el tiempo. Sora soluciona las deformaciones estructurales previas.\n\n⚙️ [Metodología Técnica]\nEs una arquitectura de transformador de difusión (DiT) que procesa parches de video espacio-temporales en un espacio latente.\n\n📊 [Resultados Clave]\nLogra 60 segundos de video fotorrealista con movimientos complejos de cámara y persistencia de objetos.\n\n🔮 [Alcance Futuro]\nEl próximo paso es integrar motores de física reales para evitar colisiones irreales en el mundo virtual."
      },
      hi: {
        title: "सोरा: डिफ्यूजन ट्रांसफॉर्मर के साथ वीडियो जेनरेशन",
        summary: "एक टेक्स्ट-कंडीशनल डिफ्यूजन ट्रांसफॉर्मर मॉडल जो 60 सेकंड तक का उच्च-गुणवत्ता और यथार्थवादी वीडियो उत्पन्न करने में सक्षम है।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nटेक्स्ट से वीडियो बनाना एक जटिल कार्य है जिसमें समय और स्थान की समझ की आवश्यकता होती है। सोरा इसी चुनौती को हल करता है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nयह डिफ्यूजन ट्रांसफॉर्मर (DiT) आर्किटेक्चर है जो वीडियो डेटा के स्पेस-टाइम पैच पर काम करता है।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nयह मॉडल जटिल कैमरा गतिविधियों और बनावट के साथ 60 सेकंड तक का सुसंगत वीडियो बनाता है।\n\n🔮 [भविष्य की संभावना]\nभौतिकी इंजनों के नियमों को जोड़ना ताकि आभासी दुनिया में गुरुत्वाकर्षण की विसंगतियां न हों।"
      }
    }
  },
  {
    id: "alphafold-3-complexes",
    title: "AlphaFold 3: Accurate Biomolecular Interaction Predictions",
    domain: "Biotechnology",
    subdomain: "Bioinformatics",
    summary:
      "DeepMind presented a diffusion-based model that predicts the 3D structure of protein-DNA-RNA complexes and chemical modifications with atomic accuracy.",
    fullExplanation:
      "🔬 [Context & Background]\nUnderstanding cellular mechanisms requires mapping the interactions between proteins, nucleic acids, and chemical ligands. Prior models predicted isolated structures but struggled with multi-entity complex bindings.\n\n⚙️ [Technical Methodology]\nAlphaFold 3 replaces the specialized geometric modules of version 2 with a generalized Diffusion Module. The network denoises coordinates of atoms directly, utilizing structural representations generated by a deep Pairformer encoder.\n\n📊 [Key Results & Findings]\nAchieves a 50% improvement in predicting protein-ligand interactions over traditional docking pipelines, predicting proteins, DNA, RNA, and covalent chemical links inside a single unified neural pipeline.\n\n🔮 [Future Scope & Horizons]\nAccelerating drug discovery pipelines by simulating virtual bindings of experimental drugs with targeted disease receptors at high throughput.",
    authorId: "paper-team-13",
    authorName: "Google DeepMind",
    authorRole: "Structural Biology Group",
    originalLink: "https://www.nature.com/articles/s41586-024-07487-w",
    tags: ["alphafold3", "biology", "diffusion", "proteins"],
    readingTime: "5 min read",
    savedCount: 3670,
    createdAt: new Date("2025-05-10"),
    organization: "Nature Publishing Group",
    pubYear: 2024,
    doi: "10.48550/arXiv.2407.21783",
    insights: [
      "Replaces the traditional structural module with a generative diffusion model.",
      "Shows a 50% improvement in predicting protein-ligand interactions over previous models.",
      "Simulates structural transformations in drug discovery and molecular design workflows."
    ],
    illustrations: [
      `{"type": "flow-chart", "title": "Figure 1: AlphaFold 3 Architecture", "steps": ["Sequence Input", "Pairformer Encoding", "Diffusion Denoising", "3D Coordinates Output"]}`,
      `{"type": "bar-chart", "title": "Figure 2: Ligand Docking Accuracy (LDDT)", "labels": ["Classic Dock", "AlphaFold 2", "AlphaFold 3"], "values": [38, 52, 76]}`
    ],
    translations: {
      es: {
        title: "AlphaFold 3: Predicciones de interacciones biomoleculares precisas",
        summary: "Un modelo de difusión que predice la estructura 3D de complejos de proteínas, ADN y ARN con precisión atómica.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nCartografiar interacciones de proteínas y ácidos nucleicos es crucial. Modelos previos fallaban en complejos multi-entidad.\n\n⚙️ [Metodología Técnica]\nAlphaFold 3 reemplaza los módulos geométricos con un Módulo de Difusión generalizado que reduce el ruido en las coordenadas de los átomos.\n\n📊 [Resultados Clave]\nLogra un 50% de mejora en la predicción de interacciones de ligandos frente a flujos de trabajo tradicionales.\n\n🔮 [Alcance Futuro]\nAcelerar el descubrimiento de fármacos simulando uniones virtuales a gran escala."
      },
      hi: {
        title: "अल्फाफोल्ड 3: सटीक बायोमोलेक्यूलर इंटरेक्शन भविष्यवाणियां",
        summary: "एक डिफ्यूजन-आधारित मॉडल जो परमाणु सटीकता के साथ प्रोटीन-डीएनए-आरएनए परिसरों की 3D संरचना की भविष्यवाणी करता है।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nकोशिकाओं के काम करने के तरीके को समझने के लिए प्रोटीन, डीएनए और आरएनए के बीच संबंधों को समझना आवश्यक है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nअल्फाफोल्ड 3 ने ज्यामितीय मॉड्यूल की जगह एक सामान्यीकृत डिफ्यूजन मॉड्यूल का उपयोग किया है।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nपारंपरिक डॉकिंग पाइपलाइनों की तुलना में प्रोटीन-लिगैंड इंटरैक्शन की भविष्यवाणी में 50% का सुधार देखा गया है।\n\n🔮 [भविष्य की संभावना]\nलक्षित रोग रिसेप्टर्स के साथ प्रायोगिक दवाओं के आभासी संयोजनों का अनुकरण करके दवा की खोज को तेज करना।"
      }
    }
  },
  {
    id: "neuralink-telepathy-bci",
    title: "First Clinical Trial of a Fully Implantable Wireless BCI",
    domain: "Neuroscience",
    subdomain: "Brain-Computer Interfaces",
    summary:
      "A clinical study validating a fully implantable 1024-electrode wireless brain-computer interface enabling paralyzed patients to control digital devices using thoughts.",
    fullExplanation:
      "🔬 [Context & Background]\nRestoring independence to patients with severe motor disabilities requires high-bandwidth connections to the motor cortex. Previous systems used external wires, creating infection risks and restricting patient mobility.\n\n⚙️ [Technical Methodology]\nThe system integrates an array of 1024 thin-film electrodes distributed across 64 threads, implanted by a surgical robot. A wireless, hermetically-sealed device amplifies, digitizes, and transmits neural signals via Bluetooth Low Energy.\n\n📊 [Key Results & Findings]\nThe participant achieved continuous control of a digital cursor, reaching a peak communication throughput of 8.2 bits per second. The implant operated stably over 180 days with no adverse safety events.\n\n🔮 [Future Scope & Horizons]\nExpanding decoding algorithms to support multi-axis robotic limb control and restoring sensory feedback loops by micro-stimulating target sensory cortex regions.",
    authorId: "paper-team-14",
    authorName: "Neuralink Team",
    authorRole: "Neurotechnology Engineers",
    originalLink: "https://neuralink.com/blog/prime-study-progress-update/",
    tags: ["bci", "neuroscience", "implant", "brain-control"],
    readingTime: "4 min read",
    savedCount: 2840,
    createdAt: new Date("2025-06-01"),
    organization: "Neuralink Research Circle",
    pubYear: 2024,
    doi: "10.1097/BCI.2024.xxxxx",
    insights: [
      "Operates 1024 thin-film electrodes across 64 threads inserted by a robotic device.",
      "Achieves real-time cursor control with a bit rate of over 8.2 bits per second.",
      "Maintains signal stability and patient safety over a continuous 180-day implant period."
    ],
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: Communication Bit Rate (BPS) Over Time", "labels": ["Day 1", "Day 7", "Day 30", "Day 90"], "values": [1.5, 4.2, 7.8, 8.2]}`,
      `{"type": "flow-chart", "title": "Figure 2: Signal Conversion Chain", "steps": ["Brain Electrode", "Amplifier IC", "BLE Digitizer", "Target OS Cursor"]}`
    ],
    translations: {
      es: {
        title: "Primer ensayo clínico de una BCI inalámbrica totalmente implantable",
        summary: "Un estudio clínico que valida una interfaz cerebro-computadora inalámbrica de 1024 electrodos que permite controlar dispositivos digitales con el pensamiento.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nRestaurar la movilidad requiere conexiones de banda ancha con la corteza motora. Los sistemas previos usaban cables externos peligrosos.\n\n⚙️ [Metodología Técnica]\nEl sistema integra 1024 electrodos en 64 hilos, implantados por un robot quirúrgico y transmitiendo por Bluetooth de bajo consumo.\n\n📊 [Resultados Clave]\nEl participante logró controlar un cursor digital a 8.2 bits por segundo sin incidentes de seguridad durante 180 días.\n\n🔮 [Alcance Futuro]\nExpandir la decodificación para controlar prótesis robóticas de múltiples ejes y restaurar la retroalimentación sensorial."
      },
      hi: {
        title: "पूरी तरह से प्रत्यारोपण योग्य वायरलेस बीसीआई का पहला नैदानिक परीक्षण",
        summary: "एक नैदानिक अध्ययन जो 1024-इलेक्ट्रोड वाले वायरलेस ब्रेन-कंप्यूटर इंटरफ़ेस को मान्य करता है, जिससे लकवाग्रस्त मरीज विचारों का उपयोग करके डिजिटल उपकरणों को नियंत्रित कर सकते हैं।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nगंभीर विकलांगता वाले रोगियों की स्वतंत्रता बहाल करने के लिए मस्तिष्क की सतह से सीधे डिजिटल लिंक की आवश्यकता होती है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nइस प्रणाली में 1024 पतले इलेक्ट्रोड थ्रेड्स शामिल हैं, जिन्हें एक रोबोट द्वारा प्रत्यारोपित किया जाता है और डेटा ब्लूटूथ द्वारा भेजा जाता है।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nरोगी ने 8.2 बिट प्रति सेकंड की गति से डिजिटल कर्सर पर नियंत्रण हासिल किया, और 180 दिनों तक कोई प्रतिकूल प्रभाव नहीं देखा गया।\n\n🔮 [भविष्य की संभावना]\nमस्तिष्क नियंत्रण के माध्यम से कृत्रिम अंगों का संचालन करना और संवेदी प्रतिक्रिया देना।"
      }
    }
  },
  {
    id: "ethereum-proof-of-stake",
    title: "The Ethereum Merge: Transition to Proof of Stake",
    domain: "Blockchain & Web3",
    subdomain: "Consensus Mechanisms",
    summary:
      "An empirical analysis of the energy savings and security metrics following Ethereum's transition from Proof of Work to Proof of Stake consensus.",
    fullExplanation:
      "🔬 [Context & Background]\nProof of Work block validation relies on energy-intensive cryptographic computations, drawing heavy criticism regarding carbon footprints. The Merge represents the largest consensus mechanism transition in network history.\n\n⚙️ [Technical Methodology]\nWe analyzed transaction throughput, validator participation metrics, and block time intervals before and after the merge timestamp. The network replaced hash-power miners with validator nodes staking 32 ETH in smart contracts.\n\n📊 [Key Results & Findings]\nThe consensus upgrade reduced Ethereum's electrical energy consumption by 99.95%, decreasing global carbon impact instantly. Network block times stabilized at exactly 12-second intervals, with over 99% validator attestation rates.\n\n🔮 [Future Scope & Horizons]\nImplementing stateless validation schemes and data availability sampling to scale network capacity through Layer 2 rollups.",
    authorId: "paper-team-15",
    authorName: "Consensys Academics",
    authorRole: "Blockchain Protocols Team",
    originalLink: "https://ethereum.org/en/roadmap/merge/",
    tags: ["ethereum", "pos", "merge", "blockchain"],
    readingTime: "4 min read",
    savedCount: 1740,
    createdAt: new Date("2024-03-12"),
    organization: "ACM Blockchain Proceedings",
    pubYear: 2023,
    doi: "10.1145/3600006.xxxx",
    insights: [
      "Eliminates mining hardware compute grids, reducing global network energy consumption by 99.95%.",
      "Secures the network through validator staking capital (over 30 million staked ETH).",
      "Normalizes block creation intervals to exactly 12 seconds, reducing latency variation."
    ],
    illustrations: [
      `{"type": "bar-chart", "title": "Figure 1: Global Energy Draw (TWh/year)", "labels": ["Bitcoin", "ETH (PoW)", "ETH (PoS)"], "values": [110, 78, 0.01]}`,
      `{"type": "flow-chart", "title": "Figure 2: PoS Validator Flow", "steps": ["Stake 32 ETH", "Epoch Proposer Draw", "Block Assembly", "Attestation Check"]}`
    ],
    translations: {
      es: {
        title: "La fusión de Ethereum: Transición a la prueba de participación",
        summary: "Un análisis empírico del ahorro de energía y la seguridad tras la transición de Ethereum de la prueba de trabajo a la prueba de participación.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nEl bloque de validación por prueba de trabajo consume demasiada energía. La fusión representa la mayor transición técnica en blockchain.\n\n⚙️ [Metodología Técnica]\nAnalizamos el rendimiento de transacciones y participación. Se reemplazaron los mineros tradicionales por validadores con 32 ETH en depósito.\n\n📊 [Resultados Clave]\nRedujo el consumo eléctrico de Ethereum en un 99.95%, bajando el impacto de carbono al instante. Los tiempos de bloque se normalizaron a 12 segundos.\n\n🔮 [Alcance Futuro]\nImplementar esquemas de validación sin estado para escalar la red a través de rollups."
      },
      hi: {
        title: "एथेरियम मर्ज: प्रूफ ऑफ स्टेक में संक्रमण",
        summary: "एथेरियम के प्रूफ ऑफ वर्क से प्रूफ ऑफ स्टेक पर संक्रमण के बाद ऊर्जा बचत और सुरक्षा मेट्रिक्स का एक अनुभवजन्य विश्लेषण।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nप्रूफ ऑफ वर्क ब्लॉक निर्माण के लिए भारी मात्रा में कंप्यूटर ऊर्जा की आवश्यकता होती थी, जिसकी आलोचना होती थी। मर्ज इस समस्या का समाधान करता है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nनेटवर्क ने माइनिंग हार्डवेयर की जगह 32 ETH स्टेक करने वाले वैलिडेटर्स को शामिल किया।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nइस संक्रमण ने एथेरियम की बिजली खपत को 99.95% कम कर दिया, और ब्लॉक बनने का समय ठीक 12 सेकंड पर स्थिर हो गया।\n\n🔮 [भविष्य की संभावना]\nसॉफ्टवेयर स्तर पर स्केलेबिलिटी बढ़ाने के लिए डेटा उपलब्धता सैंपलिंग को लागू करना।"
      }
    }
  },
  {
    id: "climate-carbon-capture",
    title: "Direct Air Capture of CO2 Using Solid Sorbents",
    domain: "Climate Tech",
    subdomain: "Carbon Capture",
    summary:
      "A material optimization study evaluating amine-functionalized metal-organic frameworks (MOFs) that capture CO2 from ambient air with minimal heat regeneration requirements.",
    fullExplanation:
      "🔬 [Context & Background]\nLimiting global warming requires active removal of carbon dioxide from the atmosphere. Current Direct Air Capture (DAC) systems suffer from high energy regenerate thresholds, making scaling economically difficult.\n\n⚙️ [Technical Methodology]\nWe synthesized a series of metal-organic frameworks (MOFs) functionalized with diamines. We evaluated their carbon adsorption capacities and kinetics under mock ambient air environments (400 ppm CO2) across varying humidity ranges.\n\n📊 [Key Results & Findings]\nThe optimized MOF captured CO2 selectively under humid conditions, reducing target desorption energy by 35% compared to commercial liquid amine systems. The structure maintained high durability over 500 regeneration cycles.\n\n🔮 [Future Scope & Horizons]\nScaling up MOF sorbent production to industrial scale and designing modular adsorption bed structures powered by waste heat grids.",
    authorId: "paper-team-16",
    authorName: "Climate Materials Alliance",
    authorRole: "Chemical Engineering Group",
    originalLink: "https://pubs.acs.org/doi/10.1021/acs.est.xxxx",
    tags: ["carbon-capture", "mofs", "climate-tech", "sorbents"],
    readingTime: "4 min read",
    savedCount: 1980,
    createdAt: new Date("2025-07-01"),
    organization: "ACS Environmental Science",
    pubYear: 2024,
    doi: "10.1021/acs.est.xxxx",
    insights: [
      "Captures carbon dioxide selectively in high humidity regimes without moisture saturation.",
      "Reduces regeneration energy thresholds by 35% compared to liquid amine scrubbers.",
      "Projects long-term chemical durability with less than 2% loss in capture capacity after 500 cycles."
    ],
    illustrations: [
      `{"type": "line-chart", "title": "Figure 1: CO2 Capture Capacity Over Humidity (%)", "labels": ["RH 0", "RH 25", "RH 50", "RH 75"], "values": [1.4, 1.45, 1.48, 1.49]}`,
      `{"type": "flow-chart", "title": "Figure 2: Capture Cycle Steps", "steps": ["Air Filtration", "Amine CO2 Binding", "Low Temp Heat Release", "Pure CO2 Storage"]}`
    ],
    translations: {
      es: {
        title: "Captura directa de CO2 en el aire utilizando sorbentes sólidos",
        summary: "Evaluación de estructuras metalorgánicas (MOF) que capturan CO2 del aire ambiental con bajos requisitos de energía de regeneración.",
        fullExplanation: "🔬 [Contexto y Antecedentes]\nMitigar el calentamiento global requiere la remoción activa de CO2. Los sistemas actuales consumen demasiada energía térmica.\n\n⚙️ [Metodología Técnica]\nSintetizamos estructuras metalorgánicas (MOF) funcionalizadas con diaminas, evaluando su absorción a 400 ppm de CO2.\n\n📊 [Resultados Clave]\nEl MOF optimizado redujo la energía de desorción en un 35% y mantuvo su rendimiento durante 500 ciclos de regeneración.\n\n🔮 [Alcance Futuro]\nEscalar la producción de MOF y diseñar lechos modulares alimentados por calor residual industrial."
      },
      hi: {
        title: "ठोस सोरबेंट्स का उपयोग करके हवा से CO2 का प्रत्यक्ष कैप्चर",
        summary: "अमीन-कार्यात्मक धातु-कार्बनिक फ्रेमवर्क (MOF) का मूल्यांकन जो न्यूनतम थर्मल ऊर्जा आवश्यकताओं के साथ हवा से CO2 कैप्चर करते हैं।",
        fullExplanation: "🔬 [संदर्भ और पृष्ठभूमि]\nग्लोबल वार्मिंग को सीमित करने के लिए वातावरण से सक्रिय रूप से कार्बन डाइऑक्साइड निकालने की आवश्यकता है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nहमने डायमाइन्स के साथ धातु-कार्बनिक फ्रेमवर्क (MOFs) का संश्लेषण किया और हवा (400 ppm CO2) में इसके सोखने की क्षमता का परीक्षण किया।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nअनुकूलित MOF ने पारंपरिक लिक्विड अमीन की तुलना में रीजेनरेशन ऊर्जा में 35% की कमी की, और 500 चक्रों के बाद भी स्थिरता दिखाई।\n\n🔮 [भविष्य की संभावना]\nऔद्योगिक स्तर पर MOF का उत्पादन बढ़ाना और कारखानों की बची हुई गर्मी से कार्बन कैप्चर बेड को चलाना।"
      }
    }
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
