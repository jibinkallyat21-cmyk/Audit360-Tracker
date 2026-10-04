/** Select strings shared by the pages and the PostgREST integration test. */
export const SUBPROCESS_SELECT =
  "id, seq, title, current_stage, current_status, review_decision, dashboard_status, updated_at, processes!inner(id, process_code, title, phases!inner(name, display_order))";
export const ASSIGNMENT_SELECT =
  "process_id, person_id, assignment_type, people!inner(display_name)";
export const PERSON_ROLES_SELECT = "roles!inner(name)";
export const PROCESS_DETAIL_SELECT = "title, description, source_reference, context";
export const COMMENTS_SELECT =
  "id, subprocess_id, review_point_id, parent_comment_id, author_id, comment_text, created_at";
export const REVIEW_POINTS_SELECT =
  "id, subprocess_id, raised_by, assigned_to_person_id, description, status, resolution_note, submitted_at, closed_by, closed_at, created_at, owner:people!assigned_to_person_id(display_name)";
export const DOCUMENTS_SELECT =
  "id, subprocess_id, review_point_id, original_filename, created_at, document_versions(id, version_number, original_filename, file_size, version_note, uploaded_by, uploaded_at, is_current)";
export const TESTING_SELECT =
  "id, subprocess_id, submitted_by, result, notes, evidence_document_id, created_at";
export const APPROVALS_SELECT =
  "id, subprocess_id, review_point_id, approval_type, decision, decided_by, decision_note, decided_at";
export const ACTIVITY_SELECT =
  "id, actor_id, action_type, entity_type, entity_id, previous_value, new_value, process_id, subprocess_id, metadata, created_at";
export const NOTIFICATIONS_SELECT =
  "id, event_type, message, is_read, created_at, process_id, processes(process_code)";
export const PEOPLE_SELECT = "id, display_name, first_name";
export const ROLE_TAGS_SELECT = "person_id, roles!inner(name)";
export const TEAMS_SELECT = "id, name, production_lead_person_id, team_members(person_id)";
