import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paper } from "@/types/models";

export type ResearchProject = {
  id: string;
  name: string;
  description: string;
  papers: Paper[];
  notes: string[];
  literatureReviewQuery?: string;
  createdAt: Date;
};

const PROJECTS_STORAGE_KEY = "shords.researchProjects.v1";

export class ResearchProjectsManager {
  static async getProjects(): Promise<ResearchProject[]> {
    try {
      const raw = await AsyncStorage.getItem(PROJECTS_STORAGE_KEY);
      if (!raw) {
        return [
          {
            id: "proj-1",
            name: "My LLM & Tensor Optimization Thesis",
            description: "Research workspace for LLM inference latency & hardware-aware attention.",
            papers: [],
            notes: ["Key focus: FlashAttention kernel optimization & Mamba sequence scaling."],
            literatureReviewQuery: "Recent advances in federated learning and hardware-aware deep learning",
            createdAt: new Date()
          }
        ];
      }
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static async saveProject(project: ResearchProject): Promise<void> {
    try {
      const projects = await this.getProjects();
      const existingIdx = projects.findIndex(p => p.id === project.id);
      if (existingIdx >= 0) {
        projects[existingIdx] = project;
      } else {
        projects.push(project);
      }
      await AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    } catch (e) {
      console.error("Project save error:", e);
    }
  }
}
