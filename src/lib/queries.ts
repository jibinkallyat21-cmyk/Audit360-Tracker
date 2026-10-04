/** Select strings shared by the pages and the PostgREST integration test. */
export const SUBPROCESS_SELECT =
  "id, seq, title, current_stage, current_status, review_decision, dashboard_status, updated_at, processes!inner(id, process_code, title, phases!inner(name, display_order))";
export const ASSIGNMENT_SELECT =
  "process_id, person_id, assignment_type, people!inner(display_name)";
export const PERSON_ROLES_SELECT = "roles!inner(name)";
export const PROCESS_DETAIL_SELECT = "title, description, source_reference, context";
