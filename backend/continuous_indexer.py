import asyncio
from federated_search import FederatedSearchEngine
from metadata_engine import CanonicalPaper

DISCOVERY_TOPICS = ["Machine Learning", "Quantum Computing", "Genomics", "Robotics", "Renewable Energy"]

class ContinuousIndexer:
    """
    COMPONENT 12: Continuous Indexing
    Background workers continuously discover new papers from registered research providers.
    Hourly check -> Store metadata -> Do NOT summarize yet (until requested or precomputed).
    """
    @staticmethod
    async def run_hourly_ingestion_cycle():
        print("[Continuous Indexer]: Running hourly research paper discovery cycle...")
        for topic in DISCOVERY_TOPICS:
            try:
                print(f"[Continuous Indexer]: Discovering latest papers in domain '{topic}'...")
                papers = await FederatedSearchEngine.search_all(query=topic, limit=10)
                print(f"[Continuous Indexer]: Discovered & indexed {len(papers)} papers for topic '{topic}'. Metadata cached.")
            except Exception as e:
                print(f"[Continuous Indexer Error]: Failed cycle for {topic}: {e}")

if __name__ == "__main__":
    asyncio.run(ContinuousIndexer.run_hourly_ingestion_cycle())
