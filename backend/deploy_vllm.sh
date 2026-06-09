#!/usr/bin/env bash

# deploy_vllm.sh
# Production script to launch the Vision-Language model using vLLM for high-throughput concurrent requests.
# Prerequisites: pip install vllm

MODEL_ID="Qwen/Qwen2-VL-7B-Instruct"
PORT=8001
TENSOR_PARALLEL_SIZE=1 # Change to 2 or 4 if using multiple GPUs (e.g. 2x RTX 3090 / A10G)

echo "Starting vLLM Engine for ${MODEL_ID} on port ${PORT}..."
echo "Configuring Tensor Parallel size: ${TENSOR_PARALLEL_SIZE}"

python -m vllm.entrypoints.openai.api_server \
    --model ${MODEL_ID} \
    --port ${PORT} \
    --tensor-parallel-size ${TENSOR_PARALLEL_SIZE} \
    --dtype float16 \
    --max-model-len 8192 \
    --trust-remote-code

# Note: Once running, you can point your FastAPI server or client requests to:
# http://localhost:8001/v1/chat/completions (OpenAI compatible endpoint)
