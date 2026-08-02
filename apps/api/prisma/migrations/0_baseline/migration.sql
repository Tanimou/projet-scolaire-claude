-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "SchoolStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "Portal" AS ENUM ('admin', 'teacher', 'parent');

-- CreateEnum
CREATE TYPE "AcademicYearStatus" AS ENUM ('active', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('active', 'transferred', 'graduated', 'withdrawn');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('students', 'classes', 'subjects', 'teachers', 'parents', 'enrollments', 'grades', 'attendance');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'validating', 'validated', 'queued', 'applying', 'applied', 'failed', 'rolled_back');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('all_or_nothing', 'skip_invalid');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('pending', 'valid', 'invalid', 'applied', 'skipped', 'rolled_back');

-- CreateEnum
CREATE TYPE "ReconciliationClass" AS ENUM ('created', 'updated', 'unchanged', 'conflict', 'skipped');

-- CreateEnum
CREATE TYPE "ImportOrigin" AS ENUM ('csv_upload', 'oneroster');

-- CreateEnum
CREATE TYPE "RosterSourceKind" AS ENUM ('oneroster_csv', 'oneroster_rest');

-- CreateEnum
CREATE TYPE "RosterSyncStatus" AS ENUM ('idle', 'pulling', 'mapped', 'failed');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('vacation_break', 'public_holiday', 'exam_period', 'meeting', 'ceremony', 'pedagogical_day', 'custom');

-- CreateEnum
CREATE TYPE "CalendarEventScope" AS ENUM ('school_wide', 'cycle_scope', 'grade_level_scope', 'class_section_scope');

-- CreateEnum
CREATE TYPE "CalendarEventVisibility" AS ENUM ('all', 'staff_only', 'admin_only');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('mother', 'father', 'legal_guardian', 'grandparent', 'sibling', 'other');

-- CreateEnum
CREATE TYPE "GuardianshipStatus" AS ENUM ('pending', 'active', 'revoked');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('pending', 'active', 'transferred_in', 'transferred_out', 'graduated', 'dropped');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('written_test', 'oral', 'homework', 'project', 'participation', 'practical', 'other');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('draft', 'published', 'revised');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('principal', 'assistant', 'subject_teacher');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'absent_excused', 'late', 'left_early');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "AnnouncementScope" AS ENUM ('school_wide', 'cycle_scope', 'grade_level_scope', 'class_section_scope', 'individual_student', 'individual_user');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "GuardianshipClaimStatus" AS ENUM ('submitted', 'approved', 'rejected', 'match_failed', 'withdrawn');

-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('grades_xlsx', 'report_card_pdf', 'enrollment_xlsx', 'attendance_xlsx', 'audit_csv');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "AlertRuleCode" AS ENUM ('LOW_SUBJECT_AVG', 'NEGATIVE_TREND', 'REPEATED_FAILURE', 'MISSING_ASSESSMENT', 'HIGH_ABSENCE', 'TEACHER_COMMENT_FLAG', 'BEHAVIOR_ALERT', 'IMPROVEMENT');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('announcement', 'alert', 'grade_published', 'enrollment_status', 'lesson_published', 'system', 'weekly_digest', 'message', 'remediation');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('info', 'success', 'warning', 'danger');

-- CreateEnum
CREATE TYPE "NotificationCadence" AS ENUM ('instant', 'daily_digest', 'off');

-- CreateEnum
CREATE TYPE "MeetingRequestStatus" AS ENUM ('open', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "ConversationParticipantRole" AS ENUM ('parent', 'teacher');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'read_only', 'archived', 'blocked');

-- CreateEnum
CREATE TYPE "ConversationReportStatus" AS ENUM ('open', 'reviewed', 'dismissed');

-- CreateEnum
CREATE TYPE "SnapshotTriggerReason" AS ENUM ('grade_published', 'grade_revised', 'coefficient_changed', 'manual_rebuild', 'backfill');

-- CreateEnum
CREATE TYPE "SnapshotTriggerStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "TutorType" AS ENUM ('teacher', 'external', 'peer');

-- CreateEnum
CREATE TYPE "TutorCostKind" AS ENUM ('free', 'volunteer', 'paid_offline');

-- CreateEnum
CREATE TYPE "AvailabilityKind" AS ENUM ('recurring_weekly', 'one_off');

-- CreateEnum
CREATE TYPE "RemediationPlanStatus" AS ENUM ('open', 'met', 'closed');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('requested', 'confirmed', 'completed', 'cancelled', 'declined', 'proposed_alternative');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "school_code" TEXT NOT NULL,
    "address" JSONB,
    "country" CHAR(2) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "locale" TEXT NOT NULL DEFAULT 'fr-FR',
    "status" "SchoolStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "AcademicYearStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_level" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_coefficient" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "color" TEXT,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_coefficient" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "coefficient" DECIMAL(4,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subject_coefficient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_section" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "max_students" INTEGER NOT NULL DEFAULT 30,
    "room" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "options" JSONB,
    "internal_notes" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_date" DATE,
    "external_ref" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "gender" CHAR(1),
    "nationality" CHAR(2),
    "address" JSONB,
    "photo_url" TEXT,
    "medical_notes" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "user_profile_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_profile_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "profession" TEXT,
    "address" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardianship" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "can_pickup" BOOLEAN NOT NULL DEFAULT true,
    "has_legal_custody" BOOLEAN NOT NULL DEFAULT true,
    "status" "GuardianshipStatus" NOT NULL DEFAULT 'active',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardianship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardianship_claim" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "claimed_first_name" TEXT NOT NULL,
    "claimed_last_name" TEXT NOT NULL,
    "claimed_dob" DATE,
    "claimed_external_ref" TEXT,
    "relationship" "GuardianRelationship" NOT NULL,
    "matched_student_id" UUID,
    "guardianship_id" UUID,
    "status" "GuardianshipClaimStatus" NOT NULL DEFAULT 'submitted',
    "decision_reason" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardianship_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID,
    "type" "CalendarEventType" NOT NULL,
    "scope" "CalendarEventScope" NOT NULL DEFAULT 'school_wide',
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'all',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "icon" TEXT,
    "cycle_id" UUID,
    "grade_level_id" UUID,
    "class_section_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "type" "ImportType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "raw_csv" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "mode" "ImportMode",
    "summary" JSONB NOT NULL DEFAULT '{}',
    "claimed_at" TIMESTAMPTZ(6),
    "triggered_by" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMPTZ(6),
    "applied_at" TIMESTAMPTZ(6),
    "rolled_back_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "origin" "ImportOrigin" DEFAULT 'csv_upload',
    "roster_source_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "errors" JSONB,
    "created_entity_id" UUID,
    "created_entity_type" TEXT,
    "reconciliation" "ReconciliationClass",
    "conflict_fields" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_source" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "kind" "RosterSourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "base_url" TEXT,
    "credential_ref" TEXT,
    "status" "RosterSyncStatus" NOT NULL DEFAULT 'idle',
    "last_sync_at" TIMESTAMPTZ(6),
    "last_batch_id" UUID,
    "last_error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roster_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branding" (
    "school_id" UUID NOT NULL,
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "display_name" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL DEFAULT 'oklch(0.62 0.18 250)',
    "accent_color" TEXT,
    "font_family" TEXT,
    "email_from" TEXT,
    "email_reply_to" TEXT,

    CONSTRAINT "branding_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "user_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "auth_provider_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_verified_at" TIMESTAMPTZ(6),
    "photo_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "locale" TEXT NOT NULL DEFAULT 'fr-FR',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "portal" "Portal",

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "school_id" UUID,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "external_ref" TEXT,
    "specialty" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hired_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teacher_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "weekly_hours" DECIMAL(4,2),
    "is_main_teacher" BOOLEAN NOT NULL DEFAULT false,
    "role" "AssignmentRole" NOT NULL DEFAULT 'subject_teacher',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teaching_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teaching_assignment_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "term_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AssessmentKind" NOT NULL DEFAULT 'written_test',
    "scheduled_at" TIMESTAMPTZ(6),
    "conducted_at" TIMESTAMPTZ(6),
    "max_score" DECIMAL(5,2) NOT NULL DEFAULT 20.0,
    "coefficient_override" DECIMAL(4,2),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "value" DECIMAL(5,2),
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "status" "GradeStatus" NOT NULL DEFAULT 'draft',
    "entered_by" UUID NOT NULL,
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "flagged_at" TIMESTAMPTZ(6),
    "flagged_by" UUID,
    "flag_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_revision" (
    "id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "previous_value" DECIMAL(5,2),
    "new_value" DECIMAL(5,2),
    "reason" TEXT NOT NULL,
    "revised_by" UUID NOT NULL,
    "revised_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teaching_assignment_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "topic" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teaching_assignment_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "class_session_id" UUID,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "homework" TEXT,
    "homework_due_at" DATE,
    "status" "LessonStatus" NOT NULL DEFAULT 'published',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lesson_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "arrived_at" TEXT,
    "comment" TEXT,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justified_at" TIMESTAMPTZ(6),
    "justified_by" UUID,
    "justification" TEXT,

    CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scope" "AnnouncementScope" NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'normal',
    "cycle_id" UUID,
    "grade_level_id" UUID,
    "class_section_id" UUID,
    "student_id" UUID,
    "user_profile_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "author_id" UUID NOT NULL,
    "author_role_hint" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_receipt" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "portal" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "hash" TEXT,
    "prev_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "requested_by" UUID NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" "ExportStatus" NOT NULL DEFAULT 'pending',
    "file_name" TEXT NOT NULL,
    "file_url" TEXT,
    "file_size_bytes" INTEGER,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "code" "AlertRuleCode" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'medium',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "alert_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "cadence" "NotificationCadence" NOT NULL DEFAULT 'instant',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_instance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "rule_id" UUID NOT NULL,
    "code" "AlertRuleCode" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "student_id" UUID NOT NULL,
    "subject_id" UUID,
    "class_section_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recommendation" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "alert_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "alert_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject_id" UUID,
    "alert_code" "AlertRuleCode" NOT NULL,
    "requested_by" UUID NOT NULL,
    "assigned_to_id" UUID,
    "status" "MeetingRequestStatus" NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "student_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "subject_id" UUID,
    "alert_id" UUID,
    "status" "ConversationStatus" NOT NULL DEFAULT 'active',
    "topic" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "last_message_by_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "role" "ConversationParticipantRole" NOT NULL,
    "last_read_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_role" "ConversationParticipantRole" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_report" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "conversation_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ConversationReportStatus" NOT NULL DEFAULT 'open',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_subject_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "term_id" UUID,
    "average" DECIMAL(5,2),
    "coefficient" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "grade_count" INTEGER NOT NULL DEFAULT 0,
    "class_rank" INTEGER,
    "class_size" INTEGER NOT NULL DEFAULT 0,
    "trend_delta" DECIMAL(5,2),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_event_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_subject_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_global_snapshot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "term_id" UUID,
    "global_average" DECIMAL(5,2),
    "class_average" DECIMAL(5,2),
    "class_rank" INTEGER,
    "class_size" INTEGER NOT NULL DEFAULT 0,
    "progression_delta" DECIMAL(5,2),
    "attendance_rate" DECIMAL(5,2),
    "subject_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_event_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_global_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_subject_distribution" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "term_id" UUID,
    "average" DECIMAL(5,2),
    "median" DECIMAL(5,2),
    "min_score" DECIMAL(5,2),
    "max_score" DECIMAL(5,2),
    "count_low" INTEGER NOT NULL DEFAULT 0,
    "count_mid" INTEGER NOT NULL DEFAULT 0,
    "count_high" INTEGER NOT NULL DEFAULT 0,
    "pass_rate" DECIMAL(5,2),
    "grade_count" INTEGER NOT NULL DEFAULT 0,
    "student_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_event_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_subject_distribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_recompute_trigger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "reason" "SnapshotTriggerReason" NOT NULL,
    "status" "SnapshotTriggerStatus" NOT NULL DEFAULT 'pending',
    "student_id" UUID,
    "class_section_id" UUID,
    "subject_id" UUID,
    "term_id" UUID,
    "academic_year_id" UUID,
    "coalesce_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "enqueued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "snapshot_recompute_trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "type" "TutorType" NOT NULL,
    "cost_kind" "TutorCostKind" NOT NULL DEFAULT 'free',
    "display_name" TEXT NOT NULL,
    "blurb" TEXT,
    "subject_ids" UUID[],
    "teacher_profile_id" UUID,
    "user_profile_id" UUID,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor_availability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "tutor_id" UUID NOT NULL,
    "kind" "AvailabilityKind" NOT NULL,
    "weekday" INTEGER,
    "start_time" TEXT,
    "end_time" TEXT,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tutor_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remediation_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "student_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "alert_id" UUID,
    "status" "RemediationPlanStatus" NOT NULL DEFAULT 'open',
    "objective" TEXT,
    "baseline_avg" DECIMAL(5,2),
    "baseline_trend_delta" DECIMAL(5,2),
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "remediation_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID,
    "plan_id" UUID NOT NULL,
    "tutor_id" UUID NOT NULL,
    "availability_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "booked_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "school_school_code_key" ON "school"("school_code");

-- CreateIndex
CREATE INDEX "school_tenant_id_idx" ON "school"("tenant_id");

-- CreateIndex
CREATE INDEX "academic_year_tenant_id_school_id_idx" ON "academic_year"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_school_id_name_key" ON "academic_year"("school_id", "name");

-- CreateIndex
CREATE INDEX "term_tenant_id_idx" ON "term"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "term_academic_year_id_order_index_key" ON "term"("academic_year_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "term_academic_year_id_name_key" ON "term"("academic_year_id", "name");

-- CreateIndex
CREATE INDEX "cycle_tenant_id_school_id_idx" ON "cycle"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_school_id_code_key" ON "cycle"("school_id", "code");

-- CreateIndex
CREATE INDEX "grade_level_tenant_id_school_id_idx" ON "grade_level"("tenant_id", "school_id");

-- CreateIndex
CREATE INDEX "grade_level_cycle_id_idx" ON "grade_level"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_level_school_id_code_key" ON "grade_level"("school_id", "code");

-- CreateIndex
CREATE INDEX "subject_tenant_id_school_id_idx" ON "subject"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_school_id_code_key" ON "subject"("school_id", "code");

-- CreateIndex
CREATE INDEX "subject_coefficient_tenant_id_idx" ON "subject_coefficient"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_coefficient_grade_level_id_subject_id_key" ON "subject_coefficient"("grade_level_id", "subject_id");

-- CreateIndex
CREATE INDEX "class_section_tenant_id_idx" ON "class_section"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_section_academic_year_id_grade_level_id_name_key" ON "class_section"("academic_year_id", "grade_level_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "student_user_profile_id_key" ON "student"("user_profile_id");

-- CreateIndex
CREATE INDEX "student_tenant_id_school_id_idx" ON "student"("tenant_id", "school_id");

-- CreateIndex
CREATE INDEX "student_last_name_first_name_idx" ON "student"("last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "student_school_id_external_ref_key" ON "student"("school_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_user_profile_id_key" ON "guardian"("user_profile_id");

-- CreateIndex
CREATE INDEX "guardian_tenant_id_school_id_idx" ON "guardian"("tenant_id", "school_id");

-- CreateIndex
CREATE INDEX "guardian_last_name_first_name_idx" ON "guardian"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "guardian_email_idx" ON "guardian"("email");

-- CreateIndex
CREATE INDEX "guardianship_tenant_id_idx" ON "guardianship"("tenant_id");

-- CreateIndex
CREATE INDEX "guardianship_student_id_status_idx" ON "guardianship"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "guardianship_guardian_id_student_id_key" ON "guardianship"("guardian_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardianship_claim_guardianship_id_key" ON "guardianship_claim"("guardianship_id");

-- CreateIndex
CREATE INDEX "guardianship_claim_tenant_id_status_idx" ON "guardianship_claim"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "guardianship_claim_guardian_id_status_idx" ON "guardianship_claim"("guardian_id", "status");

-- CreateIndex
CREATE INDEX "enrollment_tenant_id_idx" ON "enrollment"("tenant_id");

-- CreateIndex
CREATE INDEX "enrollment_class_section_id_status_idx" ON "enrollment"("class_section_id", "status");

-- CreateIndex
CREATE INDEX "enrollment_academic_year_id_status_idx" ON "enrollment"("academic_year_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_student_id_class_section_id_academic_year_id_key" ON "enrollment"("student_id", "class_section_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "calendar_event_tenant_id_school_id_starts_at_idx" ON "calendar_event"("tenant_id", "school_id", "starts_at");

-- CreateIndex
CREATE INDEX "calendar_event_school_id_type_idx" ON "calendar_event"("school_id", "type");

-- CreateIndex
CREATE INDEX "calendar_event_academic_year_id_idx" ON "calendar_event"("academic_year_id");

-- CreateIndex
CREATE INDEX "import_batch_tenant_id_school_id_created_at_idx" ON "import_batch"("tenant_id", "school_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batch_roster_source_id_idx" ON "import_batch"("roster_source_id");

-- CreateIndex
CREATE INDEX "import_row_batch_id_status_idx" ON "import_row"("batch_id", "status");

-- CreateIndex
CREATE INDEX "import_row_batch_id_reconciliation_idx" ON "import_row"("batch_id", "reconciliation");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_batch_id_row_index_key" ON "import_row"("batch_id", "row_index");

-- CreateIndex
CREATE INDEX "roster_source_tenant_id_school_id_idx" ON "roster_source"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_auth_provider_id_key" ON "user_profile"("auth_provider_id");

-- CreateIndex
CREATE INDEX "user_profile_tenant_id_idx" ON "user_profile"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_tenant_id_email_key" ON "user_profile"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_school_id_slug_key" ON "role"("school_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_user_profile_id_role_id_school_id_key" ON "user_role"("user_profile_id", "role_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profile_user_profile_id_key" ON "teacher_profile"("user_profile_id");

-- CreateIndex
CREATE INDEX "teacher_profile_tenant_id_school_id_idx" ON "teacher_profile"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profile_school_id_external_ref_key" ON "teacher_profile"("school_id", "external_ref");

-- CreateIndex
CREATE INDEX "teaching_assignment_tenant_id_class_section_id_idx" ON "teaching_assignment"("tenant_id", "class_section_id");

-- CreateIndex
CREATE INDEX "teaching_assignment_academic_year_id_idx" ON "teaching_assignment"("academic_year_id");

-- CreateIndex
CREATE INDEX "teaching_assignment_subject_id_idx" ON "teaching_assignment"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_assignment_teacher_profile_id_class_section_id_sub_key" ON "teaching_assignment"("teacher_profile_id", "class_section_id", "subject_id");

-- CreateIndex
CREATE INDEX "assessment_tenant_id_idx" ON "assessment"("tenant_id");

-- CreateIndex
CREATE INDEX "assessment_teaching_assignment_id_scheduled_at_idx" ON "assessment"("teaching_assignment_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "assessment_term_id_idx" ON "assessment"("term_id");

-- CreateIndex
CREATE INDEX "grade_tenant_id_idx" ON "grade"("tenant_id");

-- CreateIndex
CREATE INDEX "grade_student_id_status_idx" ON "grade"("student_id", "status");

-- CreateIndex
CREATE INDEX "grade_tenant_id_is_flagged_idx" ON "grade"("tenant_id", "is_flagged");

-- CreateIndex
CREATE UNIQUE INDEX "grade_assessment_id_student_id_key" ON "grade"("assessment_id", "student_id");

-- CreateIndex
CREATE INDEX "grade_revision_grade_id_revised_at_idx" ON "grade_revision"("grade_id", "revised_at");

-- CreateIndex
CREATE INDEX "class_session_tenant_id_idx" ON "class_session"("tenant_id");

-- CreateIndex
CREATE INDEX "class_session_teaching_assignment_id_date_idx" ON "class_session"("teaching_assignment_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_entry_class_session_id_key" ON "lesson_entry"("class_session_id");

-- CreateIndex
CREATE INDEX "lesson_entry_tenant_id_idx" ON "lesson_entry"("tenant_id");

-- CreateIndex
CREATE INDEX "lesson_entry_teaching_assignment_id_date_idx" ON "lesson_entry"("teaching_assignment_id", "date");

-- CreateIndex
CREATE INDEX "attendance_record_tenant_id_idx" ON "attendance_record"("tenant_id");

-- CreateIndex
CREATE INDEX "attendance_record_student_id_recorded_at_idx" ON "attendance_record"("student_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_class_session_id_student_id_key" ON "attendance_record"("class_session_id", "student_id");

-- CreateIndex
CREATE INDEX "announcement_tenant_id_school_id_published_at_idx" ON "announcement"("tenant_id", "school_id", "published_at");

-- CreateIndex
CREATE INDEX "announcement_scope_idx" ON "announcement"("scope");

-- CreateIndex
CREATE INDEX "announcement_receipt_user_profile_id_read_at_idx" ON "announcement_receipt"("user_profile_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_receipt_announcement_id_user_profile_id_key" ON "announcement_receipt"("announcement_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "export_job_tenant_id_status_created_at_idx" ON "export_job"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "export_job_tenant_id_school_id_created_at_idx" ON "export_job"("tenant_id", "school_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_event_status_created_at_idx" ON "outbox_event"("status", "created_at");

-- CreateIndex
CREATE INDEX "alert_rule_tenant_id_enabled_idx" ON "alert_rule"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rule_tenant_id_school_id_code_key" ON "alert_rule"("tenant_id", "school_id", "code");

-- CreateIndex
CREATE INDEX "notification_preference_tenant_id_idx" ON "notification_preference"("tenant_id");

-- CreateIndex
CREATE INDEX "notification_preference_tenant_id_cadence_email_enabled_idx" ON "notification_preference"("tenant_id", "cadence", "email_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_user_profile_id_kind_key" ON "notification_preference"("user_profile_id", "kind");

-- CreateIndex
CREATE INDEX "notification_user_profile_id_read_at_created_at_idx" ON "notification"("user_profile_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_tenant_id_kind_created_at_idx" ON "notification"("tenant_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "alert_instance_tenant_id_status_severity_detected_at_idx" ON "alert_instance"("tenant_id", "status", "severity", "detected_at");

-- CreateIndex
CREATE INDEX "alert_instance_student_id_status_detected_at_idx" ON "alert_instance"("student_id", "status", "detected_at");

-- CreateIndex
CREATE INDEX "meeting_request_tenant_id_school_id_status_created_at_idx" ON "meeting_request"("tenant_id", "school_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "meeting_request_assigned_to_id_status_created_at_idx" ON "meeting_request"("assigned_to_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_request_tenant_id_alert_id_requested_by_key" ON "meeting_request"("tenant_id", "alert_id", "requested_by");

-- CreateIndex
CREATE INDEX "conversation_tenant_id_school_id_status_last_message_at_idx" ON "conversation"("tenant_id", "school_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_parent_id_status_last_message_at_idx" ON "conversation"("parent_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_teacher_id_status_last_message_at_idx" ON "conversation"("teacher_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_student_id_idx" ON "conversation"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tenant_id_parent_id_teacher_id_student_id_key" ON "conversation"("tenant_id", "parent_id", "teacher_id", "student_id");

-- CreateIndex
CREATE INDEX "conversation_participant_tenant_id_idx" ON "conversation_participant"("tenant_id");

-- CreateIndex
CREATE INDEX "conversation_participant_user_profile_id_archived_at_idx" ON "conversation_participant"("user_profile_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participant_conversation_id_user_profile_id_key" ON "conversation_participant"("conversation_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "conversation_message_tenant_id_conversation_id_created_at_idx" ON "conversation_message"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_message_sender_id_created_at_idx" ON "conversation_message"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_report_tenant_id_school_id_status_created_at_idx" ON "conversation_report"("tenant_id", "school_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_report_conversation_id_reported_by_status_key" ON "conversation_report"("conversation_id", "reported_by", "status");

-- CreateIndex
CREATE INDEX "student_subject_snapshot_tenant_id_academic_year_id_class_s_idx" ON "student_subject_snapshot"("tenant_id", "academic_year_id", "class_section_id", "subject_id");

-- CreateIndex
CREATE INDEX "student_subject_snapshot_tenant_id_student_id_academic_year_idx" ON "student_subject_snapshot"("tenant_id", "student_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_subject_snapshot_student_id_subject_id_term_id_key" ON "student_subject_snapshot"("student_id", "subject_id", "term_id");

-- CreateIndex
CREATE INDEX "student_global_snapshot_tenant_id_academic_year_id_class_se_idx" ON "student_global_snapshot"("tenant_id", "academic_year_id", "class_section_id");

-- CreateIndex
CREATE INDEX "student_global_snapshot_tenant_id_student_id_academic_year__idx" ON "student_global_snapshot"("tenant_id", "student_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_global_snapshot_student_id_term_id_key" ON "student_global_snapshot"("student_id", "term_id");

-- CreateIndex
CREATE INDEX "class_subject_distribution_tenant_id_academic_year_id_class_idx" ON "class_subject_distribution"("tenant_id", "academic_year_id", "class_section_id");

-- CreateIndex
CREATE INDEX "class_subject_distribution_tenant_id_school_id_academic_yea_idx" ON "class_subject_distribution"("tenant_id", "school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_subject_distribution_class_section_id_subject_id_term_key" ON "class_subject_distribution"("class_section_id", "subject_id", "term_id");

-- CreateIndex
CREATE INDEX "snapshot_recompute_trigger_tenant_id_status_enqueued_at_idx" ON "snapshot_recompute_trigger"("tenant_id", "status", "enqueued_at");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_recompute_trigger_tenant_id_coalesce_key_status_key" ON "snapshot_recompute_trigger"("tenant_id", "coalesce_key", "status");

-- CreateIndex
CREATE INDEX "tutor_tenant_id_school_id_published_idx" ON "tutor"("tenant_id", "school_id", "published");

-- CreateIndex
CREATE INDEX "tutor_tenant_id_teacher_profile_id_idx" ON "tutor"("tenant_id", "teacher_profile_id");

-- CreateIndex
CREATE INDEX "tutor_availability_tenant_id_tutor_id_active_idx" ON "tutor_availability"("tenant_id", "tutor_id", "active");

-- CreateIndex
CREATE INDEX "tutor_availability_tenant_id_school_id_starts_at_idx" ON "tutor_availability"("tenant_id", "school_id", "starts_at");

-- CreateIndex
CREATE INDEX "remediation_plan_tenant_id_student_id_status_idx" ON "remediation_plan"("tenant_id", "student_id", "status");

-- CreateIndex
CREATE INDEX "remediation_plan_tenant_id_school_id_status_created_at_idx" ON "remediation_plan"("tenant_id", "school_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "remediation_plan_tenant_id_student_id_subject_id_status_key" ON "remediation_plan"("tenant_id", "student_id", "subject_id", "status");

-- CreateIndex
CREATE INDEX "booking_tenant_id_tutor_id_status_session_at_idx" ON "booking"("tenant_id", "tutor_id", "status", "session_at");

-- CreateIndex
CREATE INDEX "booking_tenant_id_plan_id_status_idx" ON "booking"("tenant_id", "plan_id", "status");

-- CreateIndex
CREATE INDEX "booking_availability_id_session_at_status_idx" ON "booking"("availability_id", "session_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "booking_availability_id_session_at_plan_id_key" ON "booking"("availability_id", "session_at", "plan_id");

-- AddForeignKey
ALTER TABLE "school" ADD CONSTRAINT "school_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_level" ADD CONSTRAINT "grade_level_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_level" ADD CONSTRAINT "grade_level_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject" ADD CONSTRAINT "subject_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_coefficient" ADD CONSTRAINT "subject_coefficient_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_coefficient" ADD CONSTRAINT "subject_coefficient_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_section" ADD CONSTRAINT "class_section_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_section" ADD CONSTRAINT "class_section_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship" ADD CONSTRAINT "guardianship_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship" ADD CONSTRAINT "guardianship_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship_claim" ADD CONSTRAINT "guardianship_claim_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship_claim" ADD CONSTRAINT "guardianship_claim_matched_student_id_fkey" FOREIGN KEY ("matched_student_id") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship_claim" ADD CONSTRAINT "guardianship_claim_guardianship_id_fkey" FOREIGN KEY ("guardianship_id") REFERENCES "guardianship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_roster_source_id_fkey" FOREIGN KEY ("roster_source_id") REFERENCES "roster_source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_source" ADD CONSTRAINT "roster_source_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branding" ADD CONSTRAINT "branding_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profile" ADD CONSTRAINT "teacher_profile_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profile" ADD CONSTRAINT "teacher_profile_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "teacher_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_teaching_assignment_id_fkey" FOREIGN KEY ("teaching_assignment_id") REFERENCES "teaching_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "teacher_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_revision" ADD CONSTRAINT "grade_revision_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_teaching_assignment_id_fkey" FOREIGN KEY ("teaching_assignment_id") REFERENCES "teaching_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "teacher_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_entry" ADD CONSTRAINT "lesson_entry_teaching_assignment_id_fkey" FOREIGN KEY ("teaching_assignment_id") REFERENCES "teaching_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_entry" ADD CONSTRAINT "lesson_entry_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "teacher_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_entry" ADD CONSTRAINT "lesson_entry_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_receipt" ADD CONSTRAINT "announcement_receipt_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_instance" ADD CONSTRAINT "alert_instance_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_instance" ADD CONSTRAINT "alert_instance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_instance" ADD CONSTRAINT "alert_instance_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_instance" ADD CONSTRAINT "alert_instance_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_request" ADD CONSTRAINT "meeting_request_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alert_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_request" ADD CONSTRAINT "meeting_request_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_request" ADD CONSTRAINT "meeting_request_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_request" ADD CONSTRAINT "meeting_request_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_request" ADD CONSTRAINT "meeting_request_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alert_instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_report" ADD CONSTRAINT "conversation_report_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_report" ADD CONSTRAINT "conversation_report_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor" ADD CONSTRAINT "tutor_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor" ADD CONSTRAINT "tutor_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "teacher_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor" ADD CONSTRAINT "tutor_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_availability" ADD CONSTRAINT "tutor_availability_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_availability" ADD CONSTRAINT "tutor_availability_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_plan" ADD CONSTRAINT "remediation_plan_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_plan" ADD CONSTRAINT "remediation_plan_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_plan" ADD CONSTRAINT "remediation_plan_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alert_instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_plan" ADD CONSTRAINT "remediation_plan_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "remediation_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_availability_id_fkey" FOREIGN KEY ("availability_id") REFERENCES "tutor_availability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

