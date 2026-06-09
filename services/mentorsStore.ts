import AsyncStorage from "@react-native-async-storage/async-storage";
import { Mentor } from "@/types/models";
import { mentors as sampleMentors } from "../data/samplePapers";

const ADDED_KEY = "shords.addedMentors";
const DELETED_KEY = "shords.deletedMentorIds";

export async function getAddedMentors(): Promise<Mentor[]> {
  const raw = await AsyncStorage.getItem(ADDED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getDeletedMentorIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DELETED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getAllMentors(): Promise<Mentor[]> {
  const added = await getAddedMentors();
  const deletedIds = await getDeletedMentorIds();
  const deletedSet = new Set(deletedIds);

  const base = sampleMentors.filter((m) => !deletedSet.has(m.id));
  const filteredAdded = added.filter((m) => !deletedSet.has(m.id));

  return [...filteredAdded, ...base];
}

export async function addMentor(mentor: Mentor): Promise<Mentor[]> {
  const current = await getAddedMentors();
  const next = [mentor, ...current.filter((m) => m.id !== mentor.id)];
  await AsyncStorage.setItem(ADDED_KEY, JSON.stringify(next));
  return getAllMentors();
}

export async function deleteMentor(id: string): Promise<Mentor[]> {
  // 1. Remove from added list
  const added = await getAddedMentors();
  const nextAdded = added.filter((m) => m.id !== id);
  await AsyncStorage.setItem(ADDED_KEY, JSON.stringify(nextAdded));

  // 2. Add to deleted list
  const deleted = await getDeletedMentorIds();
  if (!deleted.includes(id)) {
    const nextDeleted = [...deleted, id];
    await AsyncStorage.setItem(DELETED_KEY, JSON.stringify(nextDeleted));
  }

  return getAllMentors();
}
