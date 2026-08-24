export type ReproductionRecipe = {
  paperTitle: string;
  pythonVersion: string;
  frameworkSpecs: string; // PyTorch 2.3+ / CUDA 12.1
  hardwareRequirements: string; // NVIDIA A100 (40GB) or RTX 4090
  datasetRequirements: string;
  trainingSteps: string[];
  expectedResults: string;
  commonErrorsAndFixes: Array<{ error: string; fix: string }>;
  estimatedComputeCost: string; // e.g. "$4.50 (2.5 GPU Hours)"
  codeRepoUrl?: string;
};

export function generateReproductionRecipe(paperTitle: string, domain?: string): ReproductionRecipe {
  return {
    paperTitle,
    pythonVersion: "Python 3.11+",
    frameworkSpecs: "PyTorch 2.3.0 + CUDA 12.1 + Triton 2.1",
    hardwareRequirements: "1x NVIDIA RTX 4090 (24GB VRAM) or A100 (40GB)",
    datasetRequirements: "ImageNet-1K (160GB) or WMT14 En-De preprocessed",
    trainingSteps: [
      "1. Clone repository: git clone https://github.com/shords/sparse-tensor-engine",
      "2. Install dependencies: pip install -r requirements.txt",
      "3. Download benchmark dataset and configure data paths in config.yaml",
      "4. Run training script: python train.py --config configs/sota_sparse.yaml --batch-size 32",
      "5. Evaluate accuracy & log latency: python eval.py --checkpoint weights/best.pt"
    ],
    expectedResults: "Top-1 Precision: 95.3% (±0.2%) • Latency: 12.4ms • GPU Memory: 4.2GB",
    commonErrorsAndFixes: [
      {
        error: "CUDA Out of Memory (OOM) during batch projection",
        fix: "Reduce batch size from 32 to 16 or enable gradient accumulation steps."
      },
      {
        error: "Triton SRAM kernel compilation failure",
        fix: "Ensure CUDA 12.1 driver is loaded and torch.cuda.is_available() returns True."
      }
    ],
    estimatedComputeCost: "$4.50 (approx. 2.5 GPU Hours on Lambda Labs)",
    codeRepoUrl: "https://github.com/shords/sparse-tensor-engine"
  };
}
