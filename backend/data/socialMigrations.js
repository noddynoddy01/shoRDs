"use strict";
/**
 * Schema for the community layer: profiles, mentorship, messaging, notifications and the application assistant.
 * Appended to the base migrations in migrations.js (versions 4, 5, 6). Same rules as there: forward-only at runtime, each migration runs in
 * one transaction, SQL is static (no user data is ever interpolated).
 *
 * Reversal: the runtime never runs a down migration. SOCIAL_DOWN_SQL is the tested, hand-run inverse (see
 * docs/architecture/COMMUNITY_PLATFORM.md): it drops exactly the tables created here and nothing else.
 *
 * Identity: Firebase UID (`uid`) is the only external identity. No passwords or credentials are stored. Lists (interests, skills, ...) are
 * JSONB arrays because the runtime's PostgreSQL client sends arrays as JSON text.
 *
 * Deletion behaviour: deleting a profile cascades to that person's applications, requests, relationships and conversation membership.
 * Messages are removed only when their whole conversation is removed (a message never outlives its conversation, and a participant leaving
 * does not rewrite what the other person already received).
 */

const V4_PROFILES_AND_MENTORSHIP = `
  -- A shoRDs profile. Firebase authenticates; this row is the platform's own record of the person. verified_mentor can only be set by the
  -- administrator approval transaction (mentors.js); no profile-editing path writes it.
  CREATE TABLE user_profiles (
    uid                     TEXT PRIMARY KEY CHECK (char_length(uid) BETWEEN 1 AND 128),
    display_name            TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    photo_url               TEXT CHECK (photo_url IS NULL OR char_length(photo_url) <= 500),
    email                   TEXT CHECK (email IS NULL OR char_length(email) <= 320),
    persona                 TEXT NOT NULL CHECK (persona IN ('STUDENT','MENTOR','RESEARCHER','PROFESSOR','ENTHUSIAST')),
    headline                TEXT CHECK (headline IS NULL OR char_length(headline) <= 140),
    bio                     TEXT CHECK (bio IS NULL OR char_length(bio) <= 1500),
    institution             TEXT CHECK (institution IS NULL OR char_length(institution) <= 120),
    department              TEXT CHECK (department IS NULL OR char_length(department) <= 120),
    academic_level          TEXT CHECK (academic_level IS NULL OR academic_level IN ('SCHOOL','UNDERGRADUATE','POSTGRADUATE','DOCTORAL','POSTDOCTORAL','FACULTY','INDUSTRY','OTHER')),
    research_interests      JSONB NOT NULL DEFAULT '[]'::jsonb,
    research_domains        JSONB NOT NULL DEFAULT '[]'::jsonb,
    skills                  JSONB NOT NULL DEFAULT '[]'::jsonb,
    expertise               JSONB NOT NULL DEFAULT '[]'::jsonb,
    links                   JSONB NOT NULL DEFAULT '{}'::jsonb,
    availability            TEXT NOT NULL DEFAULT 'UNAVAILABLE' CHECK (availability IN ('AVAILABLE','LIMITED','UNAVAILABLE')),
    mentorship_preference   TEXT NOT NULL DEFAULT 'NONE' CHECK (mentorship_preference IN ('SEEKING_MENTOR','OFFERING_MENTORING','BOTH','NONE')),
    allow_direct_messages   BOOLEAN NOT NULL DEFAULT FALSE,
    verified_mentor         BOOLEAN NOT NULL DEFAULT FALSE,
    mentor_capacity         INTEGER NOT NULL DEFAULT 0 CHECK (mentor_capacity BETWEEN 0 AND 50),
    onboarding_completed_at TIMESTAMPTZ,
    search_text             TEXT NOT NULL DEFAULT '',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT verified_mentor OR onboarding_completed_at IS NOT NULL)
  );
  -- the verified-mentor directory (small, partial) and name/recency ordering with a stable tie-break
  CREATE INDEX user_profiles_directory_idx ON user_profiles (updated_at DESC, uid) WHERE verified_mentor AND onboarding_completed_at IS NOT NULL;
  CREATE INDEX user_profiles_directory_name_idx ON user_profiles (lower(display_name), uid) WHERE verified_mentor AND onboarding_completed_at IS NOT NULL;

  CREATE TABLE mentor_applications (
    application_id  TEXT PRIMARY KEY,
    uid             TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    status          TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
    background      TEXT NOT NULL CHECK (char_length(background) BETWEEN 20 AND 2000),
    expertise       JSONB NOT NULL DEFAULT '[]'::jsonb,
    mentoring_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
    experience      TEXT NOT NULL CHECK (char_length(experience) BETWEEN 20 AND 2000),
    portfolio_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    availability    TEXT NOT NULL CHECK (availability IN ('AVAILABLE','LIMITED')),
    capacity        INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
    reviewer_uid    TEXT,
    review_note     TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 500),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- one open application and one live approval per person, enforced by the database and not only by the service
  CREATE UNIQUE INDEX mentor_applications_one_pending_idx ON mentor_applications (uid) WHERE status = 'PENDING';
  CREATE UNIQUE INDEX mentor_applications_one_approved_idx ON mentor_applications (uid) WHERE status = 'APPROVED';
  CREATE INDEX mentor_applications_status_idx ON mentor_applications (status, created_at, application_id);
  CREATE INDEX mentor_applications_uid_idx ON mentor_applications (uid, created_at DESC);

  CREATE TABLE mentorship_requests (
    request_id      TEXT PRIMARY KEY,
    mentee_uid      TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    mentor_uid      TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    domain          TEXT NOT NULL CHECK (char_length(domain) BETWEEN 1 AND 80),
    interests       TEXT NOT NULL CHECK (char_length(interests) BETWEEN 10 AND 1000),
    guidance_needed TEXT NOT NULL CHECK (char_length(guidance_needed) BETWEEN 10 AND 1000),
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','CANCELLED','COMPLETED')),
    response_note   TEXT CHECK (response_note IS NULL OR char_length(response_note) <= 500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    CHECK (mentee_uid <> mentor_uid)
  );
  -- no duplicate live request between the same two people (a rejected, cancelled or completed one does not block a new request)
  CREATE UNIQUE INDEX mentorship_requests_one_live_idx ON mentorship_requests (mentee_uid, mentor_uid) WHERE status IN ('PENDING','ACCEPTED');
  CREATE INDEX mentorship_requests_mentor_idx ON mentorship_requests (mentor_uid, created_at DESC, request_id);
  CREATE INDEX mentorship_requests_mentee_idx ON mentorship_requests (mentee_uid, created_at DESC, request_id);

  CREATE TABLE mentorship_relationships (
    relationship_id TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL UNIQUE REFERENCES mentorship_requests (request_id) ON DELETE CASCADE,
    mentor_uid      TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    mentee_uid      TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    ended_by        TEXT,
    CHECK (mentee_uid <> mentor_uid),
    CHECK ((status = 'ACTIVE' AND ended_at IS NULL) OR (status = 'COMPLETED' AND ended_at IS NOT NULL))
  );
  CREATE UNIQUE INDEX mentorship_relationships_one_active_idx ON mentorship_relationships (mentor_uid, mentee_uid) WHERE status = 'ACTIVE';
  CREATE INDEX mentorship_relationships_mentor_idx ON mentorship_relationships (mentor_uid, status, started_at DESC);
  CREATE INDEX mentorship_relationships_mentee_idx ON mentorship_relationships (mentee_uid, status, started_at DESC);
`;

const V5_MESSAGING_AND_NOTIFICATIONS = `
  CREATE TABLE conversations (
    conversation_id  TEXT PRIMARY KEY,
    kind             TEXT NOT NULL CHECK (kind IN ('MENTORSHIP','DIRECT')),
    relationship_id  TEXT UNIQUE REFERENCES mentorship_relationships (relationship_id) ON DELETE CASCADE,
    direct_key       TEXT UNIQUE,
    status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
    created_by       TEXT NOT NULL,
    last_message_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((kind = 'MENTORSHIP' AND relationship_id IS NOT NULL AND direct_key IS NULL) OR (kind = 'DIRECT' AND relationship_id IS NULL AND direct_key IS NOT NULL))
  );

  CREATE TABLE conversation_participants (
    conversation_id       TEXT NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
    uid                   TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    last_read_message_id  BIGINT NOT NULL DEFAULT 0,
    joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, uid)
  );
  -- "my conversations, most recent first" without scanning other people's rows
  CREATE INDEX conversation_participants_uid_idx ON conversation_participants (uid, conversation_id);

  CREATE TABLE messages (
    message_id       BIGSERIAL PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
    sender_uid       TEXT NOT NULL,
    body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    client_id        TEXT CHECK (client_id IS NULL OR char_length(client_id) BETWEEN 8 AND 64),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX messages_conversation_idx ON messages (conversation_id, message_id DESC);
  -- a message retried after a network failure carries the same client_id and is stored once
  CREATE UNIQUE INDEX messages_client_id_idx ON messages (conversation_id, sender_uid, client_id) WHERE client_id IS NOT NULL;

  CREATE TABLE user_blocks (
    blocker_uid  TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    blocked_uid  TEXT NOT NULL REFERENCES user_profiles (uid) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_uid, blocked_uid),
    CHECK (blocker_uid <> blocked_uid)
  );
  CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_uid, blocker_uid);

  CREATE TABLE message_reports (
    report_id        BIGSERIAL PRIMARY KEY,
    reporter_uid     TEXT NOT NULL,
    conversation_id  TEXT NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
    message_id       BIGINT,
    reason           TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
    status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX message_reports_status_idx ON message_reports (status, report_id DESC);

  -- uid is not a foreign key on purpose: administrators are identified by ADMIN_UIDS and may have no profile, yet they are notified of new applications.
  CREATE TABLE notifications (
    notification_id  BIGSERIAL PRIMARY KEY,
    uid              TEXT NOT NULL,
    type             TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 60),
    title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    body             TEXT NOT NULL CHECK (char_length(body) <= 400),
    data             JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX notifications_uid_idx ON notifications (uid, notification_id DESC);
  CREATE INDEX notifications_unread_idx ON notifications (uid) WHERE read_at IS NULL;
`;

const V6_ASSISTANT = `
  -- uid is not a foreign key: the assistant is available before onboarding creates a profile.
  CREATE TABLE assistant_conversations (
    conversation_id  TEXT PRIMARY KEY,
    uid              TEXT NOT NULL CHECK (char_length(uid) BETWEEN 1 AND 128),
    title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX assistant_conversations_uid_idx ON assistant_conversations (uid, updated_at DESC, conversation_id);

  CREATE TABLE assistant_messages (
    message_id       BIGSERIAL PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES assistant_conversations (conversation_id) ON DELETE CASCADE,
    uid              TEXT NOT NULL,
    role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content          TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 12000),
    kb_version       TEXT,
    model            TEXT,
    sources          JSONB NOT NULL DEFAULT '[]'::jsonb,
    truncated        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX assistant_messages_conversation_idx ON assistant_messages (conversation_id, message_id);
`;

// v7: the fuller mentor application (affiliation, designation, biography, scholarly identifiers, free-text verification information).
// Additive and nullable so applications submitted before this version stay valid; the service requires the new fields for NEW applications.
const V7_MENTOR_APPLICATION_DETAILS = `
  ALTER TABLE mentor_applications
    ADD COLUMN institution        TEXT CHECK (institution IS NULL OR char_length(institution) BETWEEN 1 AND 120),
    ADD COLUMN designation        TEXT CHECK (designation IS NULL OR char_length(designation) BETWEEN 1 AND 120),
    ADD COLUMN professional_bio   TEXT CHECK (professional_bio IS NULL OR char_length(professional_bio) BETWEEN 20 AND 2000),
    ADD COLUMN orcid              TEXT CHECK (orcid IS NULL OR orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
    ADD COLUMN google_scholar_url TEXT CHECK (google_scholar_url IS NULL OR char_length(google_scholar_url) <= 300),
    ADD COLUMN verification_note  TEXT CHECK (verification_note IS NULL OR char_length(verification_note) <= 500);
`;

const SOCIAL_MIGRATIONS = [
  { version: 4, name: "profiles_and_mentorship", sql: V4_PROFILES_AND_MENTORSHIP },
  { version: 5, name: "messaging_and_notifications", sql: V5_MESSAGING_AND_NOTIFICATIONS },
  { version: 6, name: "assistant_conversations", sql: V6_ASSISTANT },
  { version: 7, name: "mentor_application_details", sql: V7_MENTOR_APPLICATION_DETAILS }
];

/** The inverse of version 7 alone (drops the new columns and their data). Hand-run, never by the application. */
const V7_DOWN_SQL = `
  ALTER TABLE mentor_applications DROP COLUMN IF EXISTS institution, DROP COLUMN IF EXISTS designation, DROP COLUMN IF EXISTS professional_bio,
    DROP COLUMN IF EXISTS orcid, DROP COLUMN IF EXISTS google_scholar_url, DROP COLUMN IF EXISTS verification_note;
  DELETE FROM schema_migrations WHERE version = 7;
`;

/** The inverse of versions 7, 6, 5, 4 (in that order). Hand-run, never by the application. Also removes the schema_migrations rows. */
const SOCIAL_DOWN_SQL = `
  ${V7_DOWN_SQL}
  DROP TABLE IF EXISTS assistant_messages, assistant_conversations;
  DELETE FROM schema_migrations WHERE version = 6;
  DROP TABLE IF EXISTS notifications, message_reports, user_blocks, messages, conversation_participants, conversations;
  DELETE FROM schema_migrations WHERE version = 5;
  DROP TABLE IF EXISTS mentorship_relationships, mentorship_requests, mentor_applications, user_profiles;
  DELETE FROM schema_migrations WHERE version = 4;
`;

module.exports = { SOCIAL_MIGRATIONS, SOCIAL_DOWN_SQL, V7_DOWN_SQL };
