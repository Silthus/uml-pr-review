export const descriptions = {
  get_architecture_overview:
    "Start here. Returns the module tree of the repository (or of one module) a few levels deep, with each module's kind and file count, and the heaviest dependencies between the modules shown, counted in imports. Modules are source folders; kinds such as product, layer, package, or django-app tell you what a folder is. Tests are left out unless you ask for them. The human sees the same architecture in the explorer.",
  describe_module:
    "Explains one module: its children, what it depends on, and what depends on it, each counted in imports and grouped by the far module, with the deepest modules behind each count in `via`. Use it to find where a change belongs and which existing interfaces a module already uses. Follow up with get_dependency_evidence to see the exact import lines. The explorer follows the modules you describe.",
  get_dependency_evidence:
    "Lists the exact imports from files in one module to files in another, as file:line, target file, kind, and imported names. Use it to learn a dependency's current interface before you plan a seam through it.",
  search_modules:
    "Finds modules by words in their path or in the paths of their files, for example 'feature flags facade' or 'error_tracking frontend'. Returns module paths you can pass to the other tools.",
  create_plan:
    "Starts a new architecture plan for a change you are about to make, based on the current HEAD. A plan names the modules the change will create, modify, or remove, and the seams (dependencies) it adds, removes, or keeps, each with the interface it must go through. Draft the plan before you write code; the human watches it appear in the explorer and may comment or edit. Then fill it with edit_plan.",
  get_plan:
    "Returns an architecture plan with its modules, seams, comments, and lock status, the human comments you have not answered yet, and any edits the human made since your last change. Read it before you implement and whenever a result says the human commented or changed the plan.",
  edit_plan:
    "Applies a batch of edits to a draft plan atomically: upsert_module, drop_module, upsert_seam, drop_seam, set_summary, set_base_commit, add_comment, and resolve_comment (answer a human comment with a reply). Pass the revision you last saw as expectedRevision; if the human changed the plan in between, nothing is applied and the result tells you what changed so you can retry. A seam's interface lists the files (and optionally the symbols) of the target module that the dependency must go through. Locked plans only accept comments.",
  set_plan_lock:
    "Locks or unlocks a plan. Only do this when the human has just asked you to in this conversation, and quote their words in humanRequest. A locked plan is the agreed architecture: you implement it and check against it, and you cannot change its modules or seams until the human unlocks it.",
  check_plan:
    "Checks the working tree, including uncommitted and untracked files, against a plan. Every finding names file:line and the change that would conform; apply the fixes and check again. Run it while you implement (planned work that is not done yet is reported as pending) and once more with final: true when you think you are done (anything still missing then is a violation).",
} as const;
