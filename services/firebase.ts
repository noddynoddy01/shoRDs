import { initializeApp, getApps } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { Paper, UserProfile } from "@/types/models";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID
};

const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const firebaseApp = hasFirebaseConfig
  ? getApps()[0] ?? initializeApp(firebaseConfig)
  : undefined;

export const auth = firebaseApp ? getAuth(firebaseApp) : undefined;
export const db = firebaseApp ? getFirestore(firebaseApp) : undefined;
export const storage = firebaseApp ? getStorage(firebaseApp) : undefined;

export async function loginWithEmail(email: string, password: string) {
  if (!auth) throw new Error("Firebase is not configured.");
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signupWithEmail(
  name: string,
  email: string,
  password: string,
  interests: string[]
) {
  if (!auth || !db) throw new Error("Firebase is not configured.");
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName: name });
  const profile: UserProfile = {
    id: result.user.uid,
    name,
    email,
    bio: "",
    interests,
    profileImage: ""
  };
  await setDoc(doc(db, "users", result.user.uid), profile);
  return result;
}

export async function loginWithGoogleIdToken(idToken: string) {
  if (!auth) throw new Error("Firebase is not configured.");
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}

export async function fetchPapers() {
  if (!db) throw new Error("Firebase is not configured.");
  const snapshot = await getDocs(collection(db, "papers"));
  return snapshot.docs.map((paperDoc) => {
    const data = paperDoc.data();
    return {
      id: paperDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? new Date()
    } as Paper;
  });
}

export async function createPaper(
  paper: Omit<Paper, "id" | "createdAt" | "savedCount">,
  pdf?: Blob
) {
  if (!db) throw new Error("Firebase is not configured.");
  let pdfUrl = "";

  if (pdf && storage) {
    const pdfRef = ref(storage, `papers/${Date.now()}-${paper.title}.pdf`);
    await uploadBytes(pdfRef, pdf);
    pdfUrl = await getDownloadURL(pdfRef);
  }

  return addDoc(collection(db, "papers"), {
    ...paper,
    pdfUrl,
    savedCount: 0,
    createdAt: serverTimestamp()
  });
}
