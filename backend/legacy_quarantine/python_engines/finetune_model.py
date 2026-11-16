import os
import torch
from datasets import load_dataset
from transformers import (
    Qwen2VLForConditionalGeneration,
    AutoProcessor,
    TrainingArguments,
    Trainer
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

def run_training():
    print("--- Starting shoRDs AI Model Fine-Tuning Setup ---")
    
    # 1. Configuration Constants
    model_id = "Qwen/Qwen2-VL-7B-Instruct"
    output_dir = "./shords_custom_model_output"
    
    # LoRA hyperparameters
    lora_r = 8
    lora_alpha = 16
    lora_dropout = 0.05
    target_modules = ["q_proj", "v_proj", "k_proj", "o_proj"] # Target attention layers
    
    # 2. Loading Model with 4-bit Quantization (saves memory, fits on a single 16-24GB GPU)
    print("Loading quantized base model...")
    from transformers import BitsAndBytesConfig
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16
    )
    
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        model_id,
        quantization_config=bnb_config,
        device_map="auto"
    )
    
    processor = AutoProcessor.from_pretrained(model_id)
    
    # Prepare model for PEFT/QLoRA training
    model = prepare_model_for_kbit_training(model)
    
    # 3. Configuring LoRA Parameters
    print("Configuring Low-Rank Adaptation (LoRA) modules...")
    peft_config = LoraConfig(
        r=lora_r,
        lora_alpha=lora_alpha,
        target_modules=target_modules,
        lora_dropout=lora_dropout,
        bias="none",
        task_type="CAUSAL_LM"
    )
    
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()
    
    # 4. Preparing Custom Dataset (Scientific Research Paper PDFs and Summaries)
    # The dataset should consist of a list of items containing:
    # - "image": PIL Image representing the first page or diagram of the paper
    # - "text": Prompt query + full paper text
    # - "label": Structured JSON summary matching shoRDs schema
    print("Loading scientific summarization dataset...")
    try:
        # Load a mockup local JSON dataset (e.g. papers_dataset.json)
        # format: [{"text": "...", "label": "..."}]
        dataset = load_dataset("json", data_files="papers_dataset.json")
    except Exception:
        print("Warning: Local 'papers_dataset.json' not found. Creating a synthetic training sample...")
        # Synthetic mock dataset for demonstrating compiling pipeline
        import json
        synthetic_data = [
            {
                "text": "Summarize this paper: Deep residual learning for image recognition. Focus on ResNet architectures and depth optimizations.",
                "label": '{"title": "Deep Residual Learning", "domain": "AI / ML", "summary": "ResNet introduces residual connections to enable training of deeper neural networks.", "organization": "IEEE", "pubYear": 2016, "doi": "10.1109/CVPR.2016.90", "tags": ["resnet", "deep-learning", "vision"], "insights": ["Introduces residual block shortcuts", "Enables training of 152+ layers", "Outperforms traditional networks on ImageNet"], "stackCards": ["🔬 [Context]\nDeeper networks are harder to train due to vanishing gradients.", "⚙️ [Method]\nAdd identity mapping shortcut connections.", "📊 [Results]\nWon 1st place in ILSVRC 2015 with 3.57% error.", "🔮 [Horizons]\nSets foundation for all modern architectures."], "illustrations": []}'
            }
        ]
        with open("papers_dataset.json", "w") as f:
            json.dump(synthetic_data, f)
        dataset = load_dataset("json", data_files="papers_dataset.json")

    # Define simple tokenizing map function
    def preprocess_function(examples):
        inputs = examples["text"]
        targets = examples["label"]
        model_inputs = processor(text=inputs, padding="max_length", max_length=512, truncation=True)
        
        # Tokenize labels
        with processor.as_target_processor():
            labels = processor(text=targets, padding="max_length", max_length=512, truncation=True)
            
        model_inputs["labels"] = labels["input_ids"]
        return model_inputs

    tokenized_dataset = dataset.map(preprocess_function, batched=True)
    
    # 5. Training Arguments & Setup
    print("Setting up Trainer configurations...")
    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        logging_steps=10,
        num_train_epochs=3,
        save_strategy="epoch",
        fp16=True,
        report_to="none" # Disable external logging (Wandb, etc.)
    )
    
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset["train"],
        data_collator=lambda data: {
            "input_ids": torch.stack([torch.tensor(d["input_ids"]) for d in data]),
            "attention_mask": torch.stack([torch.tensor(d["attention_mask"]) for d in data]),
            "labels": torch.stack([torch.tensor(d["labels"]) for d in data])
        }
    )
    
    # 6. Execute Training
    print("--- Model training starting. Trainable parameters are locked for LoRA. ---")
    trainer.train()
    
    # Save the custom model adapters
    print("Saving fine-tuned adapters...")
    model.save_pretrained(os.path.join(output_dir, "shords_lora_adapters"))
    print("Fine-tuning completed successfully! You can load these adapters in your shords_server.py.")

if __name__ == "__main__":
    run_training()
