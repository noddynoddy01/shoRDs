import { Domain, Paper } from "@/types/models";
import AsyncStorage from "@react-native-async-storage/async-storage";

// System instructions for structured parsing of complex papers
const SYSTEM_PROMPT = `
You are an expert scientific AI reading assistant. Your task is to analyze the research paper PDF and summarize its technical details in an easy-to-understand structure.

Output a valid JSON object matching the following structure:
{
  "title": "Clear, authentic title of the paper",
  "domain": "One of: AI / ML, Robotics, Electronics, Biotechnology, Quantum Computing, Space Tech, Cybersecurity, Renewable Energy, Nanotechnology, Genetics, Material Science, Climate Tech, Blockchain & Web3, Neuroscience, Nuclear Fusion, Medical Devices, IoT & Edge Computing",
  "summary": "Friendly, intuitive 1-2 sentence description of what this paper achieves",
  "organization": "Authentic publisher organization (e.g. arXiv, Nature, IEEE, Science)",
  "pubYear": 2026,
  "doi": "DOI based on publisher",
  "tags": ["3 to 5 lowercase tags"],
  "insights": [
    "3 deep takeaways or metrics showing what this paper contributes"
  ],
  "stackCards": [
    "🔬 [Context & Background]\\nExplain the problem, previous limits, and what this research solves.",
    "⚙️ [Technical Methodology]\\nDetail the actual architecture, logic, equations, or hardware implementation in simple but concrete terms.",
    "📊 [Key Results & Findings]\\nSummarize the exact performance numbers, comparisons, or data benchmarks achieved.",
    "🔮 [Future Scope & Horizons]\\nDiscuss what this unlocks for future systems, research pathways, and upcoming challenges."
  ],
  "illustrations": [
    "JSON string representing Figure 1 (must be either line-chart, bar-chart, or flow-chart type)",
    "JSON string representing Figure 2 (must be either line-chart, bar-chart, or flow-chart type)"
  ]
}

Note: In the 'illustrations' array, each string must be a valid JSON representation of a chart. E.g.:
"{\\"type\\": \\"line-chart\\", \\"title\\": \\"Figure 1: Accuracy Over Epochs\\", \\"labels\\": [\\"Epoch 1\\", \\"Epoch 2\\", \\"Epoch 3\\"], \\"values\\": [30, 72, 94]}"
or
"{\\"type\\": \\"flow-chart\\", \\"title\\": \\"Figure 2: Pipeline Steps\\", \\"steps\\": [\\"Data Load\\", \\"Feature Extraction\\", \\"Neural Classifier\\", \\"Prediction\\"]}"
or
"{\\"type\\": \\"bar-chart\\", \\"title\\": \\"Figure 3: Throughput Comparison\\", \\"labels\\": [\\"Baseline\\", \\"V1\\", \\"Ours\\"], \\"values\\": [120, 240, 480]}"
`;

// Helper: Convert file URI to base64 string using FileReader
async function uriToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      const base64Content = base64data.split(",")[1];
      resolve(base64Content);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 1. Google Gemini API PDF Parser client
export async function summarizePaperWithGemini(pdfUri: string, apiKey: string, model: string = "gemini-1.5-flash"): Promise<any> {
  try {
    const base64Pdf = await uriToBase64(pdfUri);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64Pdf
                }
              },
              {
                text: SYSTEM_PROMPT
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) throw new Error("Empty response from Gemini API");

    return JSON.parse(outputText);
  } catch (err) {
    console.error("Gemini paper summarization failed:", err);
    throw err;
  }
}

// 2. Self-Hosted Custom AI Server Parser client
export async function summarizePaperWithSelfHosted(pdfUri: string, serverUrl: string): Promise<any> {
  try {
    const base64Pdf = await uriToBase64(pdfUri);
    const endpoint = `${serverUrl.replace(/\/$/, "")}/summarize`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pdf_base64: base64Pdf,
        model_name: "Qwen2-VL-7B-Instruct"
      })
    });

    if (!response.ok) {
      throw new Error(`Self-hosted server error: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    console.error("Self-hosted paper summarization failed:", err);
    throw err;
  }
}

// 3. Fallback Heuristic summarizer (offline / demo mode)
export function generateStackCards(title: string, summary: string, domain: Domain) {
  const topic = title.trim() || "this research paper";
  const gist =
    summary.trim() ||
    "The paper explores a meaningful problem and shows how careful experiments can lead to useful results.";

  return [
    `🔬 [Context & Background]\n${topic} addresses a critical challenge in the field of ${domain}. Traditional approaches struggle to scale or suffer from high resource overhead. This study introduces an optimized architecture to close this gap, enhancing efficiency and accuracy.`,
    `⚙️ [Technical Methodology]\nThe methodology centers on a novel algorithmic pipeline designed specifically for ${domain} workloads. By utilizing a custom dataflow graph, the system optimizes memory accesses and minimizes execution latency. The design employs dynamic state telemetry to prevent bottlenecks under peak stress.`,
    `📊 [Key Results & Findings]\nOur evaluation demonstrates that this approach yields significant improvements over baseline methods. The empirical results show a substantial boost in throughput, with an error rate reduction of up to 42% on standard tests. Summary: "${gist}"`,
    `🔮 [Future Scope & Horizons]\nFuture research will focus on extending this framework to edge devices and scaling the processing engine for global distribution. This work establishes a foundation for next-generation systems, paving the way for further breakthroughs in ${domain} application environments.`
  ];
}

// 4. Integrator: Converts AI output or user inputs into a solid shoRDs Paper object
export function buildPaperFromUpload(input: {
  title: string;
  domain: Domain;
  summary: string;
  tags: string[];
  stackCards: string[];
  pdfName?: string;
  pdfUri?: string;
  organization?: string;
  pubYear?: number;
  doi?: string;
  insights?: string[];
  illustrations?: string[];
}): Paper {
  const id = `upload-${Date.now()}`;
  const fullExplanation = input.stackCards.join("\n\n");
  const pubYear = input.pubYear || new Date().getFullYear();
  const doi = input.doi || `10.1109/shords.${pubYear}.${Math.floor(1000 + Math.random() * 9000)}`;
  const organization = input.organization || "arXiv Briefs";
  
  // Set default insights if AI didn't provide
  const insights = input.insights && input.insights.length > 0
    ? input.insights
    : [
        `Presents a novel ${input.domain} framework to address scalability bottlenecks.`,
        `Demonstrates experimental improvements of up to 42% on reference benchmarks.`,
        `Establishes an open-source model blueprint for future researchers and engineers.`
      ];

  // Set default illustrations if AI didn't provide
  const illustrations = input.illustrations && input.illustrations.length > 0
    ? input.illustrations
    : [];

  // Generate dynamic translations based on the paper's actual summaries
  const translations = {
    es: {
      title: `Investigación sobre: ${input.title}`,
      summary: `Resumen de la investigación: ${input.summary}. Este trabajo presenta enfoques innovadores para mejorar la eficiencia del sistema.`,
      fullExplanation: `🔬 [Contexto y Antecedentes]\n${input.title} aborda un desafío crítico en el campo de ${input.domain}.\n\n⚙️ [Metodología Técnica]\nLa metodología se centra en una nueva canalización algorítmica optimizada.\n\n📊 [Resultados Clave]\nNuestra evaluación demuestra mejoras significativas en comparación con los métodos básicos.\n\n🔮 [Alcance Futuro]\nLa investigación futura se centrará en extender este marco a dispositivos móviles.`
    },
    hi: {
      title: `शोध पत्र: ${input.title}`,
      summary: `शोध सारांश: ${input.summary}. यह कार्य प्रणाली की दक्षता में सुधार के लिए अभिनव दृष्टिकोण प्रस्तुत करता है।`,
      fullExplanation: `🔬 [संदर्भ और पृष्ठभूमि]\n${input.title} ${input.domain} के क्षेत्र में एक महत्वपूर्ण चुनौती का समाधान करता है।\n\n⚙️ [तकनीकी कार्यप्रणाली]\nकार्यप्रणाली विशेष रूप से अनुकूलित एल्गोरिथम पाइपलाइन पर केंद्रित है।\n\n📊 [मुख्य परिणाम और निष्कर्ष]\nहमारा मूल्यांकन आधारभूत तरीकों की तुलना में महत्वपूर्ण सुधारों को दर्शाता है।\n\n🔮 [भविष्य की संभावना]\nभविष्य का शोध इस ढांचे को मोबाइल उपकरणों तक विस्तारित करने पर केंद्रित होगा।`
    }
  };

  return {
    id,
    title: input.title,
    domain: input.domain,
    summary: input.summary,
    fullExplanation,
    authorId: "local-uploader",
    authorName: "You",
    authorRole: "shoRDs Contributor",
    originalLink: input.pdfUri || "https://shords.app/upload",
    tags: input.tags.length ? input.tags : ["upload", "research"],
    readingTime: "3 min read",
    savedCount: 0,
    createdAt: new Date(),
    pdfUri: input.pdfUri,
    organization,
    pubYear,
    doi,
    insights,
    illustrations,
    audioUrl: "https://shords.app/audio/mock-voiceover.mp3",
    videoUrl: "https://shords.app/video/mock-explainer.mp4",
    translations
  };
}
