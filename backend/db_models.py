import json
from typing import Optional, Dict, Any, List
from sqlalchemy import Column, String, Integer, Boolean, Text, DateTime, Float, ForeignKey, JSON
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()

class UserModel(Base):
    """COMPONENT 20 & 22: User Profile, Preferences & Research Memory."""
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=True)
    research_interests = Column(JSON, default=list)  # List of domain tags
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    memory = relationship("UserMemoryModel", uselist=False, back_populates="user")
    uploads = relationship("PaperUploadModel", back_populates="uploader")

class PaperMetadataModel(Base):
    """COMPONENT 4 & 22: Research Database (Metadata, DOI, Links, Cache). No PDF storage."""
    __tablename__ = "paper_metadata"

    id = Column(String, primary_key=True)
    title = Column(Text, nullable=False)
    authors = Column(JSON, default=list)
    doi = Column(String, index=True, nullable=True)
    year = Column(Integer, index=True, default=2026)
    abstract = Column(Text, default="")
    publication = Column(String, default="")
    publisher = Column(String, default="")
    pdf_url = Column(Text, nullable=True)
    html_url = Column(Text, nullable=True)
    license = Column(String, default="Unknown")
    keywords = Column(JSON, default=list)
    citation_count = Column(Integer, default=0)
    research_field = Column(String, default="General Science")
    institution = Column(String, default="")
    source = Column(String, default="")
    is_open_access = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Generated Stack Relationship
    stack = relationship("PaperStackModel", uselist=False, back_populates="paper")

class PaperStackModel(Base):
    """COMPONENT 4, 7, 8, 10: Generated shoRDs Stack (Summary, Roadmap, Quiz, Flashcards, Media)."""
    __tablename__ = "paper_stacks"

    id = Column(String, primary_key=True)
    paper_id = Column(String, ForeignKey("paper_metadata.id"), nullable=False)
    
    summary_short = Column(Text, nullable=False)
    full_explanation = Column(Text, nullable=False)
    roadmap = Column(JSON, default=list)
    quiz = Column(JSON, default=list)
    flashcards = Column(JSON, default=list)
    
    figures = Column(JSON, default=list)        # COMPONENT 16
    audio_podcast = Column(JSON, default=dict)  # COMPONENT 17
    video_summary = Column(JSON, default=dict)  # COMPONENT 18
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    paper = relationship("PaperMetadataModel", back_populates="stack")

class PaperUploadModel(Base):
    """COMPONENT 19: Researcher Upload & Direct Submissions."""
    __tablename__ = "paper_uploads"

    id = Column(String, primary_key=True)
    uploader_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(Text, nullable=False)
    doi = Column(String, nullable=True)
    pdf_storage_url = Column(Text, nullable=False)
    status = Column(String, default="PENDING")  # PENDING | VERIFIED | PUBLISHED
    created_at = Column(DateTime, default=datetime.utcnow)

    uploader = relationship("UserModel", back_populates="uploads")

class UserMemoryModel(Base):
    """COMPONENT 20: Personal AI Research Memory."""
    __tablename__ = "user_memory"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    bookmarks = Column(JSON, default=list)
    history = Column(JSON, default=list)
    highlights = Column(JSON, default=list)
    vector_profile_id = Column(String, nullable=True)

    user = relationship("UserModel", back_populates="memory")
