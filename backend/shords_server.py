import os
import json
import redis
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings
from source_registry import registry
from federated_search import FederatedSearchEngine
from metadata_engine import CanonicalPaper
from celery_worker import celery_app, process_paper_stack_task
from celery.result import AsyncResult

app = FastAPI(
    title="shoRDs 2.0 Federated Research API",
    description="Microservices API engine powering federated research search, canonical metadata engine, domain feeds, and multi-modal AI stacks.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

# -------------------------------------------------------------
# 1. SEARCH API & SOURCE REGISTRY
# -------------------------------------------------------------
@app.get("/api/v1/search/sources")
async def get_registered_sources():
    return {"sources": [s.dict() for s in registry.get_active_sources()]}

@app.get("/api/v1/search")
async def federated_search(
    q: str = Query(..., description="Research query term"),
    open_access_only: bool = Query(False),
    year_start: Optional[int] = Query(None),
    year_end: Optional[int] = Query(None),
    sort_by: str = Query("relevance", description="relevance | recency | oldest | citations"),
    limit: int = Query(20, ge=1, le=50),
    page: int = Query(1, ge=1)
):
    filters = {
        "open_access_only": open_access_only,
        "year_start": year_start,
        "year_end": year_end,
        "sort_by": sort_by
    }
    papers = await FederatedSearchEngine.search_all(query=q, filters=filters, limit=limit, page=page)
    return {
        "query": q,
        "page": page,
        "limit": limit,
        "count": len(papers),
        "papers": [p.dict() for p in papers]
    }

# -------------------------------------------------------------
# 2. DOMAIN SEPARATION & DEDICATED FEEDS (Issues 6, 7, 8, 9)
# -------------------------------------------------------------
@app.get("/api/v1/domains/{domain_id}/feed")
async def get_domain_feed(
    domain_id: str,
    category: str = Query("popular", description="popular | trending | latest | most_cited | open_access"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50)
):
    """
    COMPONENT 6 & 7: Dedicated Domain Feed with Backend Infinite Scrolling.
    """
    sort_map = {
        "popular": "citations",
        "trending": "relevance",
        "latest": "recency",
        "most_cited": "citations",
        "open_access": "relevance"
    }
    sort_by = sort_map.get(category, "relevance")
    oa_only = category == "open_access"

    filters = {"sort_by": sort_by, "open_access_only": oa_only}
    papers = await FederatedSearchEngine.search_all(query=domain_id.replace("_", " "), filters=filters, limit=limit, page=page)

    return {
        "domain_id": domain_id,
        "category": category,
        "page": page,
        "papers": [p.dict() for p in papers]
    }

# -------------------------------------------------------------
# 3. STACK API & JOB QUEUE (Components 8, 9, 10, 15)
# -------------------------------------------------------------
class QueueStackRequest(BaseModel):
    paper: dict

@app.post("/api/v1/stack/queue")
async def queue_paper_stack(req: QueueStackRequest):
    paper_id = req.paper.get("id")
    cache_key = f"shords:stack:{paper_id}"

    try:
        cached = redis_client.get(cache_key)
        if cached:
            return {"task_id": "CACHE_HIT", "status": "SUCCESS", "stack": json.loads(cached)}
    except Exception:
        pass

    task = process_paper_stack_task.delay(req.paper)
    return {"task_id": task.id, "status": "PENDING"}

@app.get("/api/v1/stack/status/{task_id}")
async def get_stack_task_status(task_id: str):
    if task_id == "CACHE_HIT":
        return {"status": "SUCCESS", "progress": 100}
        
    task_result = AsyncResult(task_id, app=celery_app)
    if task_result.status == "SUCCESS":
        return {"status": "SUCCESS", "progress": 100, "stack": task_result.result}
    elif task_result.status == "FAILURE":
        return {"status": "FAILURE", "error": str(task_result.result)}
    else:
        return {"status": task_result.status, "progress": 50}

@app.get("/")
def read_root():
    return {"message": "shoRDs 2.0 Research Intelligence API operational"}
