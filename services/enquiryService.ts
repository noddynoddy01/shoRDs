import AsyncStorage from "@react-native-async-storage/async-storage";

export type PaperEnquiry = {
  id: string;
  paperId: string;
  paperTitle: string;
  authorName: string;
  senderName: string;
  senderEmail: string;
  questionText: string;
  createdAt: string;
  status: "pending" | "answered";
  replyText?: string;
};

const ENQUIRIES_STORAGE_KEY = "shords.paperEnquiries";

export async function getPaperEnquiries(paperId?: string): Promise<PaperEnquiry[]> {
  try {
    const val = await AsyncStorage.getItem(ENQUIRIES_STORAGE_KEY);
    const list: PaperEnquiry[] = val ? JSON.parse(val) : getSampleEnquiries();
    if (paperId) {
      return list.filter(e => e.paperId === paperId);
    }
    return list;
  } catch (err) {
    console.error("Error reading paper enquiries:", err);
    return getSampleEnquiries();
  }
}

export async function sendPaperEnquiry(
  paperId: string,
  paperTitle: string,
  authorName: string,
  senderName: string,
  senderEmail: string,
  questionText: string
): Promise<PaperEnquiry> {
  const newEnquiry: PaperEnquiry = {
    id: `enquiry-${Date.now()}`,
    paperId,
    paperTitle,
    authorName,
    senderName,
    senderEmail,
    questionText,
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  const existing = await getPaperEnquiries();
  const updated = [newEnquiry, ...existing];
  await AsyncStorage.setItem(ENQUIRIES_STORAGE_KEY, JSON.stringify(updated));
  return newEnquiry;
}

function getSampleEnquiries(): PaperEnquiry[] {
  return [
    {
      id: "enquiry-1",
      paperId: "paper-1",
      paperTitle: "Attention Is All You Need",
      authorName: "Ashish Vaswani et al.",
      senderName: "PhD Scholar (IIIT Surat)",
      senderEmail: "scholar@iiitsurat.ac.in",
      questionText: "How does multi-head self-attention scale when sequence length exceeds 16k tokens?",
      createdAt: new Date().toISOString(),
      status: "answered",
      replyText: "When sequence length exceeds 16k tokens, standard $O(N^2)$ memory explodes. We recommend applying FlashAttention-2 or linear kernel approximations."
    }
  ];
}
