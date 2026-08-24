import os
import json
import redis
import asyncio
from celery import Celery
from config import settings
from metadata_engine import CanonicalPaper
from ai_pipeline import AIProcessingPipeline

# Initialize Celery app instance
celery_app = Celery(
    "shords_worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_concurrency=4  # Parallel worker concurrency for independent stack jobs
)

# Initialize Redis connection for multi-tier caching (COMPONENT 10)
redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

@celery_app.task(name="process_paper_stack_task", bind=True)
def process_paper_stack_task(self, paper_dict: dict):
    """
    COMPONENT 8: Multi-Worker Parallel Stack Generator
    COMPONENT 9: Non-Blocking Asynchronous Job Worker
    COMPONENT 10: Cache Verification
    """
    paper_id = paper_dict.get("id")
    cache_key = f"shords:stack:{paper_id}"

    # 1. Check Redis Cache
    try:
        cached_stack = redis_client.get(cache_key)
        if cached_stack:
            print(f"[Celery Worker {self.request.id}]: CACHE HIT for paper {paper_id}. Returning instant stack.")
            return json.loads(cached_stack)
    except Exception as e:
        print(f"[Celery Worker Cache Warning]: {e}")

    # 2. Reconstruct Canonical Paper
    paper = CanonicalPaper(**paper_dict)

    # 3. Execute Async AI Pipeline in worker thread loop
    print(f"[Celery Worker {self.request.id}]: Processing paper '{paper.title}' (Paper ID: {paper_id})...")
    loop = asyncio.get_event_loop()
    if loop.is_closed():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
    stack_result = loop.run_until_complete(AIProcessingPipeline.process_paper(paper))

    # 4. Save to Cache
    try:
        redis_client.set(cache_key, json.dumps(stack_result), ex=86400 * 30)  # Cache for 30 days
        print(f"[Celery Worker {self.request.id}]: Saved generated stack to Redis cache under key '{cache_key}'.")
    except Exception as e:
        print(f"[Celery Worker Cache Save Warning]: {e}")

    return stack_result
