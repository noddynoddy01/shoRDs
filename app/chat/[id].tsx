import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  Clipboard,
  Alert,
  ScrollView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius } from "@/constants/theme";
import { getMessages, sendMessage } from "@/services/chatService";
import { getCurrentUser } from "@/services/subscriptionService";
import { Message, UserProfile, Mentor } from "@/types/models";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // Chat session ID
  const { colors, fontSizeScale, theme } = useTheme();
  
  // Core states
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [mentorProfile, setMentorProfile] = useState<Mentor | null>(null);
  const [chatPartnerName, setChatPartnerName] = useState("Research Mentor");

  // Advanced Interactive features
  const [isTyping, setIsTyping] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimer = useRef<any>(null);

  const flatListRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const styles = getStyles(colors, fontSizeScale, theme);

  // Suggestions for rapid academic chats
  const chatSuggestions = [
    "How do I use this app?",
    "How to upload a paper?",
    "What is Premium?",
    "Explain AI/ML research",
    "How to save papers?",
    "What datasets should I use?",
    "Explain quantum computing",
    "How to change theme?",
  ];

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        setCurrentUser(user);
        
        // Load messages
        getMessages(id).then(setMessages);

        // Fetch details of active mentor
        AsyncStorage.getItem("shords.chatSessions").then((raw) => {
          if (raw) {
            try {
              const sessions = JSON.parse(raw);
              const session = sessions.find((s: any) => s.id === id);
              if (session) {
                const rawPartnerName = session.participantNames.find((name: string) => name !== user.name);
                // Anonymize AI bot — never show personal names for AI sessions
                const isAiSession =
                  session.participants?.includes("abhinav-ai") ||
                  rawPartnerName?.toLowerCase().includes("abhinav") ||
                  rawPartnerName === "AI Bot";
                const partnerName = isAiSession ? "AI Bot" : rawPartnerName;
                if (partnerName) setChatPartnerName(partnerName);

                // Fetch mentor profile matching name to extract research focus
                import("@/services/mentorsStore").then(({ getAllMentors }) => {
                  getAllMentors().then((mentors) => {
                    const match = mentors.find((m) => m.name === partnerName);
                    if (match) setMentorProfile(match);
                  });
                });
              }
            } catch (err) {
              console.warn("Chat setup error:", err);
            }
          }
        });
      }
    });

    // Poll for new messages every 3 seconds for mock real-time updates
    const interval = setInterval(() => {
      getMessages(id).then((msgs) => {
        if (msgs.length !== messages.length) {
          setMessages(msgs);
        }
      });
    }, 3000);

    return () => {
      clearInterval(interval);
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, [id, messages.length]);

  // Handle pulsing typing indicator
  useEffect(() => {
    if (isTyping) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true })
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isTyping]);

  // Main sendMessage trigger + AI response router
  async function handleSend(textToSend?: string) {
    const text = textToSend || inputText.trim();
    if (!text || !currentUser) return;

    if (!textToSend) setInputText("");

    // 1. Save user's message
    const userMsg = await sendMessage(id, currentUser.id, text);
    setMessages((current) => [...current, userMsg]);
    scrollToBottom();

    // 2. Trigger AI Mentor response after small typing delay
    setIsTyping(true);
    setTimeout(async () => {
      try {
        const responseText = await queryAIMentor(text);
        // Save mentor's reply (mentor's ID is derived from chat partner name)
        const mentorId = mentorProfile?.id || "mentor-ai";
        const mentorMsg = await sendMessage(id, mentorId, responseText);
        
        setMessages((current) => [...current, mentorMsg]);
        scrollToBottom();
      } catch (err) {
        console.warn("AI response generation failed:", err);
      } finally {
        setIsTyping(false);
      }
    }, 2000);
  }

  // Core AI Mentor response generation
  async function queryAIMentor(userText: string): Promise<string> {
    const aiSource = await AsyncStorage.getItem("shords.aiSource") || "heuristic";
    const mentorName = chatPartnerName;
    const mentorFocus = mentorProfile?.focus || "advanced engineering research";

    if (aiSource === "self-hosted") {
      const serverUrl = await AsyncStorage.getItem("shords.serverUrl") || "http://192.168.1.100:8000";
      const endpoint = `${serverUrl.replace(/\/$/, "")}/chat`;
      try {
        const payload = {
          messages: [{ role: "user", content: userText }],
          persona: `You are the AI Bot inside shoRDs, a research paper discovery app. You help users navigate the app and understand research papers.`
        };
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          const data = await response.json();
          return data.text;
        }
      } catch (e) {
        console.warn("Self-hosted chat failed, fallback to local:", e);
      }
    } else if (aiSource === "gemini") {
      const geminiKey = await AsyncStorage.getItem("shords.geminiKey");
      if (geminiKey) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        try {
          const appContext = `You are the AI Bot inside shoRDs — a research paper discovery app. shoRDs lets users swipe through research briefs like a feed, upload papers as PDFs, chat with AI mentors, save papers, listen to audio summaries, and switch themes. You help users understand research papers AND how to use the app. Be concise, warm, and always end with a follow-up question or suggestion to keep the conversation going.`;
          const prompt = `${appContext}\n\nUser message: "${userText}"\n\nRespond helpfully in 2-3 sentences max.`;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          });
          if (response.ok) {
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || getHeuristicResponse(userText);
          }
        } catch (e) {
          console.warn("Gemini chat failed, fallback to local:", e);
        }
      }
    }

    return getHeuristicResponse(userText);
  }

  function getHeuristicResponse(userText: string): string {
    const query = userText.toLowerCase();
    const mentorFocus = mentorProfile?.focus || "advanced engineering research";

    // ─── Greetings & Identity ───────────────────────────────────────────────
    if (query.match(/^(hi|hey|hello|hii|helo|howdy|yo|sup)\b/)) {
      return "Hey there! 👋 I'm your AI Bot on shoRDs — I can help you navigate the app, understand research papers, or answer questions about any topic. What would you like to explore today?";
    }
    if (query.match(/(who are you|what are you|your name|are you ai|are you a bot|are you human)/)) {
      return "I'm the AI Bot built into shoRDs! 🤖 I'm here to help you get the most out of the app — from navigating features to breaking down complex research papers. What can I help you with?";
    }
    if (query.match(/(how are you|how r u|how're you)/)) {
      return "I'm running at full capacity and ready to help! 😊 shoRDs is loaded with features — want me to walk you through any of them, or do you have a research question?";
    }
    if (query.match(/(thank|thanks|thank you|thx|ty\b)/)) {
      return "You're very welcome! 🙌 Always here if you need help with the app or any research topic. Anything else you'd like to know?";
    }
    if (query.match(/(bye|goodbye|see you|cya|exit)/)) {
      return "Goodbye! 👋 Come back anytime — your saved papers and chat history will be right here. Happy researching!";
    }

    // ─── shoRDs App Features ────────────────────────────────────────────────
    if (query.match(/(what is shords|what does shords do|about the app|tell me about|explain the app|how does this app work)/)) {
      return "shoRDs is a research paper discovery app! 📚 You can swipe through research briefs like a social feed, listen to audio summaries, upload your own papers, chat with AI mentors, and save papers for later. Think of it as TikTok — but for academic research. Want me to explain any specific feature?";
    }
    if (query.match(/(how to use|how do i|getting started|tutorial|guide|walkthrough)/)) {
      return "Getting started is simple! 🚀 On the Home feed, swipe up/down to browse research briefs. Tap any card to read the full paper. Use the bottom tabs to Explore by domain, connect with Mentors, Upload papers, or view your Profile. Want me to go deeper on any of these?";
    }
    if (query.match(/(feed|swipe|scroll|brief|stack|reel|card)/)) {
      return "The Home Feed shows research papers as swipeable stacks — each card is called a 'Brief' or 'Stack'. 📖 Swipe up to see the next paper. The right-side rail has buttons to Save, Share, Mute audio, or Read the full paper. The counter at the top shows which brief you're on. Want to know about any specific feed feature?";
    }
    if (query.match(/(upload|add paper|submit paper|how to upload|my paper|pdf)/)) {
      return "To upload a paper, tap the ✦ Upload tab at the bottom. 📤 You can paste an arXiv/DOI link or upload a PDF from your device. The AI will automatically extract the title, summary, domain, tags, and key insights. After uploading, it appears instantly in the feed. Would you like tips on formatting your paper for best results?";
    }
    if (query.match(/(save|bookmark|saved paper|reading list|library)/)) {
      return "Tap the 🔖 Save button on any research brief in the feed to add it to your library. You can find all saved papers in the Explore tab under 'Saved'. Papers stay saved even when you close the app. Have you tried saving any papers yet?";
    }
    if (query.match(/(audio|listen|voice|read aloud|tts|text to speech|mute|sound)/)) {
      return "shoRDs has built-in audio summaries! 🔊 When a paper is active on screen, it automatically reads the title and summary aloud. Use the Mute button on the right rail to toggle audio on/off. You can also set your preferred language in the Settings. Would you like to know how to change the audio language?";
    }
    if (query.match(/(search|find paper|look up|query paper)/)) {
      return "Tap the 🔍 Search icon in the top-right of the Home screen to search across all research papers. You can search by title, author, domain, or keywords. Results update as you type. Is there a specific paper or topic you're looking for?";
    }
    if (query.match(/(explore|domain|category|topic|filter|browse)/)) {
      return "The Explore tab lets you browse papers by research domain — AI/ML, Quantum Computing, Robotics, Biotechnology, and more. 🔬 You can also filter by Saved papers. Each domain shows all briefs tagged to that field. Which research domain interests you most?";
    }
    if (query.match(/(mentor|research guide|expert|connect|guidance|professor)/)) {
      return "The Mentors tab shows academic researchers available for guidance. 👨‍🏫 Tap 'Connect' on a mentor card to start a chat session with them. I (AI Bot) am always available for instant help. Premium users can access all mentors for personalised research direction. Would you like to know more about connecting with mentors?";
    }
    if (query.match(/(premium|subscription|unlock|paywall|free|upgrade|plan|pay)/)) {
      return "shoRDs offers a Free tier and a Premium plan. 💎 Free users can read 5 research papers before needing to upgrade. Premium unlocks unlimited papers, all mentor chats, multi-language translations, and priority support. You can subscribe from the Paywall screen or via the Settings. Want to know what's included in Premium?";
    }
    if (query.match(/(profile|account|my account|settings|edit profile|bio|change)/)) {
      return "Tap the 👤 Profile tab to view and edit your name, bio, interests, language, and country. You can also manage your subscription and log out from the Settings tray (⚙️ icon on the Home screen). Is there something specific you'd like to update in your profile?";
    }
    if (query.match(/(theme|dark mode|light mode|appearance|color|night mode)/)) {
      return "shoRDs starts in Light theme by default ☀️. You can switch to Dark mode using the banner notification that appears on the Home feed, or through the ⚙️ Settings tray. There are also special themes: Nord, Sepia, and Emerald. Which theme are you currently using?";
    }
    if (query.match(/(language|translate|translation|hindi|spanish|multi.?language)/)) {
      return "shoRDs supports multi-language paper summaries! 🌍 Go to Profile → Settings and select your preferred language (English, Hindi, or Spanish). Papers with translations will display in your chosen language, and audio will also read in that language. Want to know which papers support translations?";
    }
    if (query.match(/(notification|alert|banner|recommendation)/)) {
      return "shoRDs shows a Dark Mode recommendation banner on the Home screen when you're using Light theme. 🌙 Toggle the switch or tap the button in the banner to switch instantly. Other in-app alerts notify you about saves, shares, and subscription updates. Anything else you'd like to know?";
    }
    if (query.match(/(contact|support|help|report|feedback|team|reach out)/)) {
      return "You can reach the shoRDs team via the Contact page — find it in the Mentors tab at the bottom. 📬 Use it for research upload support, mentor onboarding, or any feedback. The team typically responds within 24 hours. What issue can I help you with right now?";
    }
    if (query.match(/(delete|remove paper|remove account|remove mentor)/)) {
      return "To delete a paper from the feed, tap the 🗑️ Delete button on the right rail (visible if you're the uploader or an admin). To remove an account or mentor, please use the Contact page to reach the shoRDs team. Is there something specific you'd like to remove?";
    }
    if (query.match(/(share|send paper|share link|share this)/)) {
      return "Tap the 📤 Share button on the right rail of any research brief to share it via any app on your phone (WhatsApp, email, etc.). The share message includes the title, summary, author, and a download link for shoRDs. Want to know any other sharing tips?";
    }
    if (query.match(/(illustration|chart|graph|visualization|diagram)/)) {
      return "Papers in shoRDs often include dynamic vector illustrations — bar charts, line graphs, and flow diagrams generated from the paper data. 📊 These show key metrics and research processes visually. You can tap the card to see the full explanation. Would you like to know how to upload papers with illustrations?";
    }
    if (query.match(/(login|sign in|sign up|register|auth|password|email)/)) {
      return "To use shoRDs, tap 'Sign In' on the welcome screen and enter your email and password. 🔐 New users can register with a name, email, and password. Your credentials are saved securely on the device. Are you having trouble signing in?";
    }

    // ─── Research / Academic Topics ─────────────────────────────────────────
    if (query.match(/(ai|artificial intelligence|machine learning|deep learning|neural|llm|gpt|transformer)/)) {
      return "AI/ML is one of the most active research domains on shoRDs! 🤖 Topics include transformers, large language models, reinforcement learning, computer vision, and edge AI. You can filter for AI/ML papers in the Explore tab. Is there a specific AI concept you'd like me to explain?";
    }
    if (query.match(/(quantum|qubit|superposition|entanglement|quantum error|quantum computing)/)) {
      return "Quantum computing research focuses on using quantum mechanical phenomena to solve problems classical computers can't handle efficiently. ⚛️ Key concepts include qubits (quantum bits), superposition (being 0 and 1 simultaneously), entanglement, and quantum error correction. What aspect of quantum computing are you most curious about?";
    }
    if (query.match(/(robot|robotics|autonomous|drone|actuator|servo)/)) {
      return "Robotics research on shoRDs covers autonomous systems, sensor fusion, path planning, manipulation, and human-robot interaction. 🦾 Modern robots use deep learning for perception and reinforcement learning for control. Is there a specific robotics application you're researching?";
    }
    if (query.match(/(biotech|biology|gene|dna|crispr|protein|genomics|bioinformatics)/)) {
      return "Biotechnology research includes CRISPR gene editing, protein folding, genomics, drug discovery, and synthetic biology. 🧬 Papers on shoRDs cover both wet-lab experimental work and computational bioinformatics. Do you want me to explain any specific biotech concept?";
    }
    if (query.match(/(cyber|security|hack|encryption|network|firewall|vulnerability|malware)/)) {
      return "Cybersecurity research covers threat detection, cryptography, network security, ethical hacking, and privacy. 🔒 Trending areas include AI-based intrusion detection and post-quantum cryptography. Which cybersecurity topic are you most interested in?";
    }
    if (query.match(/(climate|environment|renewable|solar|wind|energy|carbon|sustainability)/)) {
      return "Climate tech and renewable energy are major research areas on shoRDs! 🌱 Papers cover solar photovoltaics, wind turbines, battery storage, carbon capture, and smart grids. Would you like to find papers on a specific clean energy technology?";
    }
    if (query.match(/(iot|internet of things|edge computing|sensor|embedded|firmware)/)) {
      return "IoT and Edge Computing research covers connected devices, low-power sensors, real-time processing at the network edge, and embedded AI. 📡 Key challenges include latency, security, and energy efficiency. Is there a specific IoT application you're exploring?";
    }
    if (query.match(/(space|satellite|rocket|nasa|orbit|spacecraft|astronomy)/)) {
      return "Space tech research includes satellite communication, propulsion systems, orbital mechanics, and deep space exploration. 🚀 Papers on shoRDs cover both theoretical astrophysics and applied aerospace engineering. Is there a mission or technology you'd like to know more about?";
    }
    if (query.match(/(nano|nanotechnology|nanomaterial|graphene|carbon nanotube)/)) {
      return "Nanotechnology research deals with materials and devices at the nanometer scale. ⚗️ This includes graphene applications, carbon nanotubes, nanomedicine, and nanoelectronics. The properties of materials change dramatically at this scale. What specific nano application interests you?";
    }
    if (query.match(/(neuro|brain|neuroscience|cognition|bci|brain computer|neural interface)/)) {
      return "Neuroscience research on shoRDs covers brain-computer interfaces (BCI), neural signal processing, cognitive science, and neurological disorder treatments. 🧠 BCIs are particularly exciting — they allow direct communication between the brain and computers. What aspect of neuroscience are you curious about?";
    }
    if (query.match(/(blockchain|web3|crypto|decentralized|smart contract|nft)/)) {
      return "Blockchain and Web3 research covers decentralized systems, consensus algorithms, smart contracts, DeFi, and digital identity. ⛓️ Key research questions involve scalability, energy efficiency, and security. Is there a specific blockchain application you're investigating?";
    }
    if (query.match(/(medical|healthcare|clinical|diagnosis|imaging|mri|disease|drug)/)) {
      return "Medical devices and healthcare research on shoRDs includes AI diagnostics, medical imaging (MRI/CT), drug delivery systems, wearable health monitors, and clinical trial methodology. 🏥 What specific medical research topic can I help you with?";
    }
    if (query.match(/(nuclear|fusion|plasma|reactor|energy|fission)/)) {
      return "Nuclear fusion research aims to replicate the energy source of stars here on Earth. ☢️ Projects like ITER and private ventures like Commonwealth Fusion are making breakthroughs in plasma containment. The goal is clean, virtually limitless energy. What aspect of fusion research interests you?";
    }
    if (query.match(/(material|alloy|composite|polymer|semiconductor|conductor)/)) {
      return "Material science research explores new materials for electronics, construction, energy, and medicine. 🔬 Current hot areas include 2D materials, metamaterials, biodegradable polymers, and perovskite solar cells. Is there a specific material application you're researching?";
    }
    if (query.match(/(genetics|evolution|dna|rna|mutation|heredity|chromosome)/)) {
      return "Genetics research covers DNA sequencing, gene expression, mutations, and hereditary diseases. 🧬 Modern tools like CRISPR-Cas9 allow precise gene editing. Computational genomics uses AI to analyze massive genetic datasets. What genetics concept would you like to explore?";
    }

    // ─── Paper & Research Process Concepts ──────────────────────────────────
    if (query.match(/(abstract|summary|introduction|conclusion|methodology)/)) {
      return "The abstract is a concise summary of a research paper — it covers the problem, approach, results, and conclusion in 150-250 words. 📄 In shoRDs, every paper's brief IS the abstract enhanced with key insights and visual charts. Would you like to know how to write a strong abstract?";
    }
    if (query.match(/(citation|reference|bibliography|cite|apa|mla|ieee)/)) {
      return "Citations give credit to prior work and let readers verify your sources. 📖 The IEEE format (used in engineering) looks like: [1] Author, 'Title,' Journal, vol., pp., year. DOI links are shown on shoRDs paper cards. Do you need help formatting a specific citation?";
    }
    if (query.match(/(peer review|journal|publication|submit|conference|arxiv|doi)/)) {
      return "Peer review is the process where independent experts evaluate a paper before publication. ✅ arXiv is a popular preprint server where papers are shared before formal peer review. A DOI (Digital Object Identifier) is a permanent link to the paper. You can tap a paper's DOI on shoRDs to visit the original. Want tips on submitting your research?";
    }
    if (query.match(/(dataset|data|training data|test set|benchmark|corpus)/)) {
      return "Datasets are collections of structured data used to train and evaluate research models. 📊 Common sources include IEEE DataPort, Kaggle, UCI ML Repository, and domain-specific databases. When evaluating a paper, always check if the dataset is publicly available and reproducible. What type of dataset are you looking for?";
    }
    if (query.match(/(math|formula|equation|algorithm|proof|theorem|calculus)/)) {
      return "Mathematical formulations are the backbone of research papers. ➗ Key areas include linear algebra (for ML), differential equations (for physics/engineering), probability theory (for statistics), and graph theory (for networks). Which mathematical concept are you working with?";
    }
    if (query.match(/(hypothesis|research question|problem statement|objective)/)) {
      return "A strong research hypothesis clearly states the expected relationship between variables. 🎯 Format: 'If [independent variable] is changed, then [dependent variable] will [increase/decrease] because [reasoning].' Keep it testable and specific. Do you want help refining your research question?";
    }
    if (query.match(/(result|finding|accuracy|performance|metric|benchmark|score)/)) {
      return "Research results should be presented with clear metrics — accuracy, F1 score, RMSE, latency, etc. 📈 Always compare against a baseline and report statistical significance. In shoRDs briefs, the 'Key Highlights' section summarizes the top findings. What results are you trying to interpret?";
    }
    if (query.match(/(future work|limitation|gap|research gap|next step)/)) {
      return "Every strong paper identifies its limitations and suggests future work. 🔭 Common gaps include: limited dataset size, narrow domain testing, or unexplored hyperparameter ranges. Identifying gaps is how new research questions are born. What limitation are you dealing with in your work?";
    }

    // ─── Keyword scoring for partial matches ────────────────────────────────
    const scoredResponses: Array<{ score: number; response: string; followup: string }> = [
      { score: ["upload", "paper", "pdf", "submit"].filter(k => query.includes(k)).length, response: "Uploading a paper to shoRDs is straightforward — go to the ✦ Upload tab, paste a link or pick a PDF, and our AI processes it automatically.", followup: "Would you like step-by-step instructions?" },
      { score: ["save", "bookmark", "read later", "library"].filter(k => query.includes(k)).length, response: "You can save any research brief using the 🔖 Save button on the right side of the feed card.", followup: "Want to know how to access your saved papers?" },
      { score: ["mentor", "chat", "connect", "guide"].filter(k => query.includes(k)).length, response: "The Mentors tab connects you with AI and academic guides for research support.", followup: "Would you like to know how to start a mentor session?" },
      { score: ["premium", "free", "unlock", "plan"].filter(k => query.includes(k)).length, response: "shoRDs has a Free tier (5 papers) and Premium (unlimited access + translations + all mentors).", followup: "Do you want to know more about what Premium includes?" },
      { score: ["theme", "dark", "light", "color"].filter(k => query.includes(k)).length, response: "You can change themes from the 🌙 Dark Mode banner or via Settings.", followup: "Which theme are you currently using?" },
    ];

    const best = scoredResponses.sort((a, b) => b.score - a.score)[0];
    if (best.score > 0) {
      return `${best.response} ${best.followup}`;
    }

    // ─── Graceful catch-all ─────────────────────────────────────────────────
    const catchAlls = [
      "That's a great question! I want to make sure I give you the best answer. Could you tell me more — are you asking about how to use the app, or about a research topic? 🤔",
      "I'm not 100% sure about that specific detail, but I can help! Are you looking for app guidance (like uploading, saving, or themes) or research help (like understanding a paper or concept)?",
      "Hmm, let me think about that! 💭 Could you rephrase or give me a bit more context? For example, is this about a feature in shoRDs or a scientific concept?",
      "Great question — I want to point you in the right direction. Are you trying to navigate the app, understand a paper, or explore a research domain?",
      "I'm here to help with anything on shoRDs or in research! 🙌 Can you be a bit more specific? For example, what feature or topic are you referring to?",
    ];
    return catchAlls[Math.floor(Math.random() * catchAlls.length)];
  }

  // Simulated recording voice message
  function toggleVoiceRecord() {
    if (recordingVoice) {
      // Stop recording and send mock voice message
      setRecordingVoice(false);
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      
      const durationStr = `0:${recordingDuration < 10 ? "0" : ""}${recordingDuration}`;
      handleSend(`🎤 Sent Voice Summary (${durationStr})`);
      setRecordingDuration(0);
    } else {
      // Start recording
      setRecordingVoice(true);
      setRecordingDuration(0);
      recordingTimer.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    }
  }

  // Mock Paper attachments
  function handleAttachDocument() {
    Alert.alert(
      "Attach Research Element",
      "Attach documents or figures to your scholarly conversation:",
      [
        { text: "Attach Paper Draft.pdf", onPress: () => handleSend("📄 Attached document: research_draft_v1.pdf") },
        { text: "Attach Figure Graph.png", onPress: () => handleSend("🖼️ Attached figure: results_chart_1.png") },
        { text: "Cancel", style: "cancel" }
      ]
    );
  }

  function scrollToBottom() {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }

  function formatTime(timestamp: number) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Helper: Copy code snippet to clipboard
  const copyCode = (codeText: string) => {
    Clipboard.setString(codeText);
    Alert.alert("Code Copied", "Technical snippet copied to clipboard.");
  };

  // Custom Message Bubble Renderer (supports code block highlights)
  const renderMessageContent = (msgText: string, isMe: boolean) => {
    const isCode = msgText.includes("```");
    if (isCode) {
      const parts = msgText.split("```");
      const codeSnippet = parts[1] || "";
      return (
        <View style={styles.codeMessageContainer}>
          <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {parts[0]}
          </Text>
          <View style={styles.codeBlock}>
            <View style={styles.codeHeader}>
              <Text style={styles.codeHeaderText}>Code Snippet</Text>
              <Pressable onPress={() => copyCode(codeSnippet)}>
                <Ionicons name="copy-outline" size={14} color="#94A3B8" />
              </Pressable>
            </View>
            <Text style={styles.codeText}>{codeSnippet.trim()}</Text>
          </View>
          <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {parts[2]}
          </Text>
        </View>
      );
    }

    // Attachment text
    const isAttachment = msgText.startsWith("📄") || msgText.startsWith("🖼️");
    if (isAttachment) {
      return (
        <View style={styles.attachmentBubble}>
          <Ionicons
            name={msgText.startsWith("📄") ? "document-text" : "image"}
            size={24}
            color={isMe ? "#FFFFFF" : colors.accentSoft}
          />
          <Text style={[styles.attachmentText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {msgText}
          </Text>
        </View>
      );
    }

    return (
      <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
        {msgText}
      </Text>
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {/* Modern Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.avatar}>
            <Ionicons name="school" size={20} color={colors.accentSoft} />
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{chatPartnerName}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={[styles.onlineDot, isTyping && styles.typingDot]} />
              <Text style={styles.headerStatus}>{isTyping ? "typing..." : "online"}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={styles.actionHeaderBtn} onPress={() => Alert.alert("Mentor Call", "Simulating secure voice call...")}>
              <Ionicons name="call-outline" size={18} color={colors.text} />
            </Pressable>
            <Pressable style={styles.actionHeaderBtn} onPress={() => Alert.alert("Mentor Class", "Simulating video blackboard class...")}>
              <Ionicons name="videocam-outline" size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* Message Feed */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isMe = item.senderId === currentUser?.id;
            return (
              <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowOther]}>
                {!isMe && (
                  <View style={styles.avatarMini}>
                    <Ionicons name="person" size={12} color={colors.accentSoft} />
                  </View>
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  {renderMessageContent(item.text, isMe)}
                  <Text style={[styles.messageTime, isMe ? styles.messageTimeMe : styles.messageTimeOther]}>
                    {formatTime(item.timestamp)}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {/* Typing Bubble */}
        {isTyping && (
          <View style={styles.typingIndicatorRow}>
            <View style={styles.avatarMini}>
              <Ionicons name="person" size={12} color={colors.accentSoft} />
            </View>
            <Animated.View style={[styles.typingBubble, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.typingDotItem} />
              <View style={[styles.typingDotItem, { opacity: 0.6 }]} />
              <View style={[styles.typingDotItem, { opacity: 0.3 }]} />
            </Animated.View>
          </View>
        )}

        {/* Quick Suggestion Chips */}
        <View style={styles.suggestionsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
            {chatSuggestions.map((item) => (
              <Pressable key={item} style={styles.suggestionChip} onPress={() => handleSend(item)}>
                <Text style={styles.suggestionText}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Input area */}
        <View style={styles.inputArea}>
          <Pressable style={styles.attachBtn} onPress={handleAttachDocument}>
            <Ionicons name="add" size={20} color={colors.text} />
          </Pressable>
          
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder={recordingVoice ? "Recording Audio readout..." : "Type technical question..."}
            placeholderTextColor={colors.subdued}
            style={[styles.input, recordingVoice && styles.inputRecording]}
            multiline
            editable={!recordingVoice}
          />

          <Pressable
            style={[styles.voiceBtn, recordingVoice && styles.voiceBtnActive]}
            onPress={toggleVoiceRecord}
          >
            <Ionicons name={recordingVoice ? "stop" : "mic"} size={20} color={recordingVoice ? "#EF4444" : colors.text} />
          </Pressable>

          <Pressable
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.background
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: "rgba(6, 182, 212, 0.08)",
      borderColor: "rgba(6, 182, 212, 0.15)",
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    headerInfo: {
      flex: 1
    },
    headerTitle: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800"
    },
    headerStatus: {
      color: colors.success,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    onlineDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success
    },
    typingDot: {
      backgroundColor: colors.accentSoft
    },
    actionHeaderBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    messagesList: {
      padding: 14,
      gap: 12,
      flexGrow: 1
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      maxWidth: "85%"
    },
    messageRowMe: {
      alignSelf: "flex-end",
      flexDirection: "row-reverse"
    },
    messageRowOther: {
      alignSelf: "flex-start"
    },
    avatarMini: {
      width: 24,
      height: 24,
      borderRadius: 8,
      backgroundColor: "rgba(6, 182, 212, 0.05)",
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    bubble: {
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 4
    },
    bubbleMe: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 2
    },
    bubbleOther: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 2
    },
    messageText: {
      fontSize: 13 * scale,
      lineHeight: 18 * scale
    },
    messageTextMe: {
      color: "#FFFFFF"
    },
    messageTextOther: {
      color: colors.text
    },
    messageTime: {
      fontSize: 9 * scale,
      alignSelf: "flex-end",
      marginTop: 2
    },
    messageTimeMe: {
      color: "rgba(255,255,255,0.7)"
    },
    messageTimeOther: {
      color: colors.subdued
    },
    // Typing indicator
    typingIndicatorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 14,
      paddingBottom: 6
    },
    typingBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.pill
    },
    typingDotItem: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.accentSoft
    },
    // Suggestions
    suggestionsContainer: {
      paddingVertical: 6,
      backgroundColor: colors.background
    },
    suggestionsScroll: {
      paddingHorizontal: 14,
      gap: 8
    },
    suggestionChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1
    },
    suggestionText: {
      color: colors.accentSoft,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    // Code blocks formatting
    codeMessageContainer: {
      gap: 6,
      width: "100%"
    },
    codeBlock: {
      backgroundColor: "#0F172A",
      borderRadius: radius.sm,
      padding: 10,
      marginVertical: 4
    },
    codeHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: "#1E293B",
      paddingBottom: 6,
      marginBottom: 6
    },
    codeHeaderText: {
      color: "#94A3B8",
      fontSize: 10 * scale,
      fontFamily: "monospace"
    },
    codeText: {
      color: "#38BDF8",
      fontFamily: "monospace",
      fontSize: 11 * scale,
      lineHeight: 16
    },
    // Attachments
    attachmentBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4
    },
    attachmentText: {
      fontSize: 13 * scale,
      fontWeight: "700"
    },
    // Input Area
    inputArea: {
      flexDirection: "row",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
      alignItems: "center",
      gap: 8
    },
    attachBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 80,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.text,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 13 * scale,
      fontWeight: "600"
    },
    inputRecording: {
      backgroundColor: "rgba(239, 68, 68, 0.05)",
      borderColor: "rgba(239, 68, 68, 0.2)",
      color: "#EF4444"
    },
    voiceBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    voiceBtnActive: {
      borderColor: "#EF4444",
      backgroundColor: "rgba(239, 68, 68, 0.08)"
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.primary,
      shadowOpacity: 0.2,
      shadowRadius: 5,
      elevation: 2
    },
    sendBtnDisabled: {
      backgroundColor: colors.subdued,
      opacity: 0.5,
      shadowOpacity: 0,
      elevation: 0
    }
  });
}
