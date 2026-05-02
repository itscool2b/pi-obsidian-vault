export const PUBLIC_TOOL_NAMES = ["obsidian_retrieve", "obsidian_validate", "obsidian_plan", "obsidian_write", "obsidian_edit", "obsidian_manage"] as const;

export const SUPPORTED_OPERATIONS = {
  obsidian_write: ["create", "append", "create_folder"],
  obsidian_edit: ["replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text"],
  obsidian_plan: ["retrieve.note", "retrieve.relationships", "validate.existing_note", "validate.proposed_content", "write.create", "write.append", "write.create_folder", "edit.replace_section", "edit.insert_under_heading", "edit.update_frontmatter", "edit.remove_frontmatter", "edit.replace_exact_text", "manage.move_note", "manage.trash_note", "manage.restore_note", "manage.copy_note"],
  obsidian_manage: ["move_note", "trash_note", "restore_note", "copy_note"],
} as const;

export const FORBIDDEN_MUTATION_CAPABILITIES = [
  "move_folder",
  "delete_folder",
  "trash_folder",
  "permanent_delete",
  "batch_delete",
  "batch_execute",
  "commit_token",
  "transaction_commit",
  "wildcard_delete",
  "recursive_delete",
  "rewrite_links",
  "open",
  "shell",
  "network",
  "scan",
  "discover",
  "command",
] as const;

export const UNSAFE_NOTE_PATHS = [
  "/tmp/outside.md",
  "C:\\Users\\me\\outside.md",
  "\\\\server\\share\\outside.md",
  "../outside.md",
  "Folder/%2e%2e/outside.md",
  "Folder/%25252e%25252e/outside.md",
  ".obsidian/plugins/x.md",
  ".hidden/Note.md",
  "Notes/file.txt",
  "Notes/file",
  "",
  "   ",
  ".",
  "@",
] as const;

export const UNSAFE_FOLDER_PATHS = [
  "/tmp/outside",
  "C:\\Users\\me\\outside",
  "\\\\server\\share\\outside",
  "../outside",
  "Folder/%2e%2e/outside",
  "Folder/%25252e%25252e/outside",
  ".obsidian/plugins",
  ".hidden/Folder",
  "Projects/Folder.md",
  "Projects/Folder.txt",
  "",
  "   ",
  ".",
  "@",
] as const;

export const UNSAFE_RESTORE_PATHS = [
  ...UNSAFE_NOTE_PATHS,
  "_Trash/*.md",
  "_Trash/**/Note.md",
  "_Trash/{A,B}.md",
  "_Trash/[abc].md",
] as const;

export const UNSAFE_COPY_PATHS = [
  ...UNSAFE_NOTE_PATHS,
  "Projects/*.md",
  "Projects/**/Note.md",
  "Projects/{A,B}.md",
  "Projects/[abc].md",
  "Projects/One.md,Projects/Two.md",
] as const;

export function assertNoForbiddenOperationText(text: string): void {
  if (/permanent_delete|batch operation|wildcard operation|recursive operation/i.test(text)) {
    throw new Error(`Unexpected unsupported capability text: ${text}`);
  }
}
